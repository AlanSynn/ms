import { BodyPartLayer, Point, StandardJoint } from '../types';
import { buildSkeleton, createProjectFromCharacterPackage } from './project';
import { isUsableContourPoints } from './partGeometry';
import { clampNumber, finiteNumber, sanitizeHexColor } from './sanitize';
import {
    validateCharacterPackageFiles,
} from '../runtime/import/projectImportPolicy';

type Dict = Record<string, unknown>;

const asDict = (v: unknown): Dict => v && typeof v === 'object' ? v as Dict : {};
const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;
const normPath = (path: string) => path.replaceAll('\\', '/').replace(/^\.?\//, '');
const scalar = (value: string): unknown => {
    const v = value.trim().replace(/^['"]|['"]$/g, '');
    if (v === 'null' || v === 'None' || v === '~') return null;
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (v.startsWith('[') && v.endsWith(']')) {
        const inner = v.slice(1, -1).trim();
        return inner ? inner.split(',').map(x => scalar(x)) : [];
    }
    return v;
};

export const parseCharConfig = (text: string): Dict => {
    try { return JSON.parse(text); } catch {}
    const out: Dict = {};
    const skeleton: Dict[] = [];
    let inSkeleton = false;
    let inJoints = false;
    let current: Dict | null = null;
    let currentSeq: string | null = null;
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.split('#')[0];
        if (!line.trim()) continue;
        const trimmed = line.trim();
        if ((inSkeleton || inJoints) && !/^\s/.test(line) && !trimmed.startsWith('-')) {
            inSkeleton = inJoints = false;
            current = null;
            currentSeq = null;
        }
        if (/^skeleton:\s*$/.test(trimmed)) { inSkeleton = true; out.skeleton = skeleton; continue; }
        if (/^joints:\s*$/.test(trimmed)) { inJoints = true; out.joints = {}; continue; }
        if (inJoints) {
            const jointMatch = line.match(/^\s{2}([\w.-]+):\s*$/);
            if (jointMatch) {
                current = { id: jointMatch[1] };
                (out.joints as Dict)[jointMatch[1]] = current;
                continue;
            }
            const propMatch = line.match(/^\s{4}(\w+):\s*(.*)$/);
            if (current && propMatch) current[propMatch[1]] = scalar(propMatch[2]);
            continue;
        }
        if (inSkeleton && /^-\s+\w+:/.test(trimmed)) {
            current = {};
            skeleton.push(current);
            const [, key, value = ''] = trimmed.match(/^-\s+(\w+):\s*(.*)$/) ?? [];
            if (key) {
                currentSeq = value ? null : key;
                current[key] = value ? scalar(value) : [];
            }
            continue;
        }
        if (inSkeleton && current && currentSeq && /^-\s+/.test(trimmed)) {
            (current[currentSeq] as unknown[]).push(scalar(trimmed.slice(1)));
            continue;
        }
        const match = trimmed.match(/^(\w+):\s*(.*)$/);
        if (!match) continue;
        const [, key, value] = match;
        if (inSkeleton && current) {
            currentSeq = value ? null : key;
            current[key] = value ? scalar(value) : [];
        } else {
            out[key] = scalar(value);
        }
    }
    return out;
};

const imagePointToScene = (p: Point, width: number, height: number): Point => ({ x: p.x - width / 2, y: height / 2 - p.y });
const legacyColor = (value: unknown, fallback = '#64748b') => {
    const text = String(value ?? '').trim();
    const hex = sanitizeHexColor(text, '');
    if (hex) return hex;
    const rgba = text.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    return rgba ? `#${rgba.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('')}` : fallback;
};

const resolveAsset = (assets: Record<string, string>, path: unknown) => {
    if (typeof path !== 'string' || !path) return undefined;
    return assets[normPath(path)] ?? assets[basename(path)];
};

const contourPointsFromPartInfo = (part: Dict): Point[] | undefined => {
    const raw = part.contour_points ?? part.contourPoints ?? part.outline_points ?? part.outlinePoints;
    const points = Array.isArray(raw) ? raw.flatMap(point => {
        const source = Array.isArray(point) ? { x: point[0], y: point[1] } : asDict(point);
        const x = Number(source.x);
        const y = Number(source.y);
        return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
    }).slice(0, 256) : [];
    return isUsableContourPoints(points) ? points : undefined;
};

const pointFrom = (value: unknown): Point | null => {
    if (Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
        return { x: Number(value[0]), y: Number(value[1]) };
    }
    const raw = asDict(value);
    if (Number.isFinite(Number(raw.x)) && Number.isFinite(Number(raw.y))) return { x: Number(raw.x), y: Number(raw.y) };
    return null;
};

const skeletonEntriesFromConfig = (cfg: Dict): Dict[] => {
    if (Array.isArray(cfg.skeleton)) return cfg.skeleton.map(asDict);
    const rawJoints = cfg.joints;
    if (Array.isArray(rawJoints)) return rawJoints.map(asDict);
    if (rawJoints && typeof rawJoints === 'object') return Object.entries(asDict(rawJoints)).map(([id, value]) => ({ id, ...asDict(value) }));
    return [];
};

export const createProjectFromPackageData = (
    partsInfo: unknown,
    charCfg: unknown,
    assets: Record<string, string> = {},
    name = 'Imported character package'
) => {
    const cfg = asDict(charCfg);
    const width = finiteNumber(cfg.width, 1);
    const height = finiteNumber(cfg.height, 1);
    const rawSkeleton = skeletonEntriesFromConfig(cfg);
    if (!rawSkeleton.length) throw new Error('char_cfg.yaml missing skeleton/joints');

    const joints: StandardJoint[] = rawSkeleton.flatMap(j => {
        const id = String(j.name || j.id || '').trim();
        const loc = pointFrom(j.loc ?? j.position);
        if (!id || !loc) return [];
        return {
            id,
            name: id,
            position: imagePointToScene(loc, width, height),
            parentId: j.parent == null && j.parent_id == null && j.parentId == null ? null : String(j.parent ?? j.parent_id ?? j.parentId),
            locked: Boolean(j.is_locked ?? j.locked),
            bendDirection: finiteNumber(j.bend_direction ?? j.bendDirection, 1)
        } satisfies StandardJoint;
    });
    if (!joints.length) throw new Error('char_cfg.yaml has no valid joints');
    const skeleton = buildSkeleton(joints);
    skeleton.metadata = { ...skeleton.metadata, sourceFormat: 'char_cfg.yaml', imageBounds: { x: 0, y: 0, width, height } };

    const info = asDict(partsInfo);
    const rawParts = asDict(asDict(info.character).parts ?? info.parts);
    if (!Object.keys(rawParts).length) throw new Error('parts_info.json missing parts');
    const jointMap = asDict(info.joint_map);
    const parts: BodyPartLayer[] = Object.entries(rawParts).map(([id, value], z) => {
        const p = asDict(value);
        const roi = Array.isArray(p.roi) ? p.roi : [0, 0, p.width ?? 80, p.height ?? 80];
        const w = clampNumber(roi[2], 80, 1, 10000);
        const h = clampNumber(roi[3], 80, 1, 10000);
        const center = imagePointToScene({ x: finiteNumber(roi[0], 0) + w / 2, y: finiteNumber(roi[1], 0) + h / 2 }, width, height);
        const pivot = Array.isArray(p.local_pivot_offset) ? p.local_pivot_offset : [w / 2, h / 2];
        const requestedAnchor = String(p.anchor_joint_id || p.anchor_joint || jointMap[id] || skeleton.rootJointIds[0] || 'root');
        const explicitAssetPath = typeof (p.texture_path ?? p.image_path) === 'string' ? String(p.texture_path ?? p.image_path) : undefined;
        const textureUrl = resolveAsset(assets, explicitAssetPath ?? `${id}.png`);
        if (explicitAssetPath && !textureUrl) throw new Error(`${id}: missing asset file ${normPath(explicitAssetPath)}`);
        const originalSvgPath = typeof (p.original_svg_path ?? p.originalSvgPath) === 'string' ? normPath(String(p.original_svg_path ?? p.originalSvgPath)) : undefined;
        const enhancedSvgPath = typeof (p.enhanced_svg_path ?? p.enhancedSvgPath) === 'string' ? normPath(String(p.enhanced_svg_path ?? p.enhancedSvgPath)) : undefined;
        const contourPoints = contourPointsFromPartInfo(p);
        const rawContourSource = p.contour_source ?? p.contourSource;
        const contourSource = rawContourSource === 'onnx-mask' || rawContourSource === 'user' || rawContourSource === 'imported' ? rawContourSource : contourPoints ? 'imported' : undefined;
        return {
            id,
            name: String(p.name || id),
            textureUrl,
            maskUrl: resolveAsset(assets, p.mask_path),
            contourPoints,
            contourSource,
            originalSvgPath,
            enhancedSvgPath,
            anchorJointId: skeleton.joints[requestedAnchor] ? requestedAnchor : skeleton.rootJointIds[0] || 'root',
            transform: { x: center.x, y: center.y, rotation: finiteNumber(p.rotation, 0), scale: finiteNumber(p.scale, 1) },
            zIndex: finiteNumber(p.z_index ?? p.z_value, z),
            opacity: clampNumber(p.opacity, 1, 0, 1),
            visible: p.visible !== false,
            locked: Boolean(p.fixed ?? p.locked),
            selectable: p.selectable !== false,
            bounds: { x: -w / 2, y: -h / 2, width: w, height: h },
            localPivotOffset: { x: finiteNumber(pivot[0], w / 2) - w / 2, y: h / 2 - finiteNumber(pivot[1], h / 2) },
            localPivotJointId: skeleton.joints[requestedAnchor] ? requestedAnchor : skeleton.rootJointIds[0] || 'root',
            group: typeof p.group === 'string' ? p.group : undefined,
            fillColor: legacyColor(p.fill_color ?? p.fillColor)
        };
    });

    return createProjectFromCharacterPackage({
        name,
        sourceImageName: name,
        skeleton,
        parts,
        replacementContext: { mode: 'plain-load', rebindingSummary: 'Starts clean with no mechanisms.' },
        keypoints: undefined
    });
};

const dataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
});

export const loadCharacterPackage = async (files: File[] | FileList) => {
    const list = Array.from(files);
    const { assets: assetFiles } = validateCharacterPackageFiles(list);
    const find = (name: string) => list.find(file => basename(file.name) === name || normPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name).endsWith(`/${name}`));
    const partsFile = find('parts_info.json');
    const cfgFile = find('char_cfg.yaml') ?? find('char_cfg.yml') ?? find('char_cfg.json');
    if (!partsFile) throw new Error('Missing parts_info.json in selected package files');
    if (!cfgFile) throw new Error('Missing char_cfg.yaml in selected package files');
    const assets: Record<string, string> = {};
    for (const file of assetFiles) {
        const key = normPath((file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name);
        const url = await dataUrl(file);
        assets[key] = url;
        assets[basename(key)] = url;
    }
    return createProjectFromPackageData(
        JSON.parse(await partsFile.text()),
        cfgFile.name.endsWith('.json') ? JSON.parse(await cfgFile.text()) : parseCharConfig(await cfgFile.text()),
        assets,
        basename((cfgFile as File & { webkitRelativePath?: string }).webkitRelativePath || cfgFile.name).replace(/\.[^.]+$/, '')
    );
};
