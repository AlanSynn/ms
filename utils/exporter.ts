
import { GlobalConfig, MechanismConfig, Point } from '../types';
import { calculateLinkage, gearTrainCenters, gearTrainOutputRatio, gearTrainPitchRadii, generateCurvePoints } from './kinematics';
import { SCENE_PX_PER_MM, SCENE_VIEW, sceneToSvg } from './coordinates';
import { finiteNumber, sanitizeHexColor, sanitizeMechanismRuntime, svgNumber } from './sanitize';
import { fabricationGearPathD } from './fabrication';

// --- DXF HELPER FUNCTIONS ---

const dxfHeader = () => `0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nENDSEC\n0\nSECTION\n2\nBLOCKS\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n`;
const dxfFooter = () => `0\nENDSEC\n0\nEOF\n`;
const dxfLayer = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || '0';

const dxfLine = (x1: number, y1: number, x2: number, y2: number, layer: string = "0", color: number = 7) => {
    return `0\nLINE\n8\n${dxfLayer(layer)}\n62\n${color}\n10\n${svgNumber(x1)}\n20\n${svgNumber(y1)}\n11\n${svgNumber(x2)}\n21\n${svgNumber(y2)}\n`;
};

const dxfCircle = (cx: number, cy: number, r: number, layer: string = "0", color: number = 7) => {
    return `0\nCIRCLE\n8\n${dxfLayer(layer)}\n62\n${color}\n10\n${svgNumber(cx)}\n20\n${svgNumber(cy)}\n40\n${svgNumber(r)}\n`;
};

const dxfPolyline = (points: Point[], layer: string = "TRACE", color: number = 3) => {
    let s = `0\nLWPOLYLINE\n8\n${dxfLayer(layer)}\n62\n${color}\n100\nAcDbEntity\n100\nAcDbPolyline\n90\n${points.length}\n70\n0\n`;
    points.forEach(p => {
        s += `10\n${svgNumber(p.x)}\n20\n${svgNumber(p.y)}\n`;
    });
    return s;
};

// --- SVG HELPER FUNCTIONS ---

export const gearPathD = (radius: number) => fabricationGearPathD(radius, radius / SCENE_PX_PER_MM);

const rawPath = (points: Point[]) => points.length ? `M ${points.map(p => `${svgNumber(p.x)} ${svgNumber(p.y)}`).join(' L ')}` : '';
const activeMechanisms = (config: GlobalConfig) => config.mechanisms.map(sanitizeMechanismRuntime).filter(m => m.visible && m.enabled !== false);

// --- EXPORT FUNCTIONS ---

export const generateDXF = (config: GlobalConfig, angle: number): string => {
    let content = dxfHeader();

    // 1. Trace Paths (Green)
    activeMechanisms(config).forEach(m => {
        if (m.type !== 'crank') {
            const { points } = generateCurvePoints(m, 100);
            if (points.length > 1) {
                content += dxfPolyline(points, "TRACE_" + m.id.toUpperCase(), 3); 
            }
        }
    });

    // 2. Mechanism Geometry (Current Frame)
    activeMechanisms(config).forEach(m => {
        const state = calculateLinkage(m, angle);
        const { p1, p2, j1, j2, aux, effector, isValid } = state;
        
        if (!isValid) return;

        const MECH_LAYER = "MECH_" + m.id.toUpperCase();

        // Crank Arm (Common)
        content += dxfLine(p1.x, p1.y, j1.x, j1.y, MECH_LAYER, 1); 
        content += dxfCircle(p1.x, p1.y, 5, "JOINTS", 7);

        if (m.type === '4bar') {
            content += dxfLine(p1.x, p1.y, p2.x, p2.y, "GROUND", 8);
            content += dxfLine(p2.x, p2.y, j2.x, j2.y, MECH_LAYER, 1);
            content += dxfLine(j1.x, j1.y, j2.x, j2.y, MECH_LAYER, 1);
            // Effector Triangle/Extension
            content += dxfLine(j1.x, j1.y, effector.x, effector.y, MECH_LAYER, 1);
            content += dxfLine(j2.x, j2.y, effector.x, effector.y, MECH_LAYER, 1);
            content += dxfCircle(p2.x, p2.y, 5, "JOINTS", 7);
        } 
        else if (m.type === '5bar' && aux) {
            content += dxfLine(p1.x, p1.y, p2.x, p2.y, "GROUND", 8);
            // Secondary Crank
            content += dxfLine(p2.x, p2.y, aux.x, aux.y, MECH_LAYER, 1);
            // Rods
            content += dxfLine(j1.x, j1.y, effector.x, effector.y, MECH_LAYER, 1);
            content += dxfLine(aux.x, aux.y, j2.x, j2.y, MECH_LAYER, 1);
            // Inner segment (virtual or real depending on design)
            content += dxfLine(j2.x, j2.y, effector.x, effector.y, MECH_LAYER, 1);
            content += dxfCircle(p2.x, p2.y, 5, "JOINTS", 7);
        }
        else if (m.type === '6bar' && aux) {
            content += dxfLine(p1.x, p1.y, p2.x, p2.y, "GROUND", 8);
            content += dxfLine(p2.x, p2.y, j2.x, j2.y, MECH_LAYER, 1);
            content += dxfLine(j1.x, j1.y, j2.x, j2.y, MECH_LAYER, 1);
            content += dxfLine(j2.x, j2.y, aux.x, aux.y, MECH_LAYER, 1);
            content += dxfLine(p2.x, p2.y, aux.x, aux.y, MECH_LAYER, 1);
            content += dxfCircle(p2.x, p2.y, 5, "JOINTS", 7);
        }
        else if (m.type === 'piston') {
            content += dxfLine(j1.x, j1.y, j2.x, j2.y, MECH_LAYER, 1);
            // Track line
            const trackAngle = (m.groundAngle || 0) * Math.PI / 180;
            const tx = Math.cos(trackAngle) * 100;
            const ty = Math.sin(trackAngle) * 100;
            content += dxfLine(j2.x - tx, j2.y - ty, j2.x + tx, j2.y + ty, "GROUND", 8);
        }
        else if (m.type === 'yoke') {
            content += dxfLine(j2.x - 40, j2.y, j2.x + 40, j2.y, MECH_LAYER, 1); // Plate
        }
        else if (m.type === 'gear') {
            gearTrainCenters(m).forEach((center, index) => {
                content += dxfCircle(center.x, center.y, gearTrainPitchRadii(m)[index] ?? m.rockerLength, `${MECH_LAYER}_GEARS`, 5);
            });
            content += dxfLine(j1.x, j1.y, effector.x, effector.y, MECH_LAYER, 1);
            content += dxfLine(j2.x, j2.y, effector.x, effector.y, MECH_LAYER, 1);
        }
        else if (m.type === 'quick-return' || m.type === 'cam' || m.type === 'planetary_gear') {
            content += dxfLine(p1.x, p1.y, p2.x, p2.y, "GROUND", 8);
            content += dxfLine(p2.x, p2.y, j2.x, j2.y, MECH_LAYER, 1);
            content += dxfLine(j2.x, j2.y, effector.x, effector.y, MECH_LAYER, 1);
        }

        // Joint Circles
        content += dxfCircle(j1.x, j1.y, 3, "JOINTS", 7);
        if (j2) content += dxfCircle(j2.x, j2.y, 3, "JOINTS", 7);
        content += dxfCircle(effector.x, effector.y, 3, "EFFECTOR", 7);
    });

    content += dxfFooter();
    return content;
};

export const generateSVG = (config: GlobalConfig, angle: number): string => {
    const origin = sceneToSvg({ x: 0, y: 0 });

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SCENE_VIEW.width} ${SCENE_VIEW.height}" style="background-color: #f8fafc">`;

    // Shared scene transform from coordinates.ts; render/export use one origin.
    svg += `<g transform="translate(${origin.x}, ${origin.y}) scale(1, -1)">`;

    // 1. Traces
    activeMechanisms(config).forEach(m => {
        if (m.type !== 'crank') {
            const { points } = generateCurvePoints(m, 100);
            if (points.length > 1) {
                svg += `<path d="${rawPath(points)}" fill="none" stroke="${sanitizeHexColor(m.color, '#3b82f6')}" stroke-width="2" opacity="0.5" stroke-linejoin="round" stroke-linecap="round" />`;
            }
        }
    });

    // 2. Mechanisms
    activeMechanisms(config).forEach(m => {
        const state = calculateLinkage(m, angle);
        const { p1, p2, j1, j2, aux, effector, isValid } = state;

        if (!isValid) return;

        const crankDeg = (angle * 180) / Math.PI;
        const color = sanitizeHexColor(m.color, '#3b82f6');

        // Anchors & Gears
        svg += `<g transform="translate(${svgNumber(p1.x)}, ${svgNumber(p1.y)}) rotate(${svgNumber(crankDeg * (m.speed1 ?? 1))})">`;
        svg += `<path d="${gearPathD(finiteNumber(m.crankLength, 1))}" fill="#f59e0b" stroke="#b45309" stroke-width="2" />`;
        svg += `<circle cx="0" cy="0" r="4" fill="#475569" stroke="white" />`;
        svg += `</g>`;

        // Output Gear for 5-bar / meshed gear train
        if (m.type === 'gear') {
             const centers = gearTrainCenters(m);
             const radii = gearTrainPitchRadii(m);
             centers.slice(1).forEach((center, index) => {
                 const gearIndex = index + 1;
                 const ratio = gearIndex === radii.length - 1
                    ? gearTrainOutputRatio(m)
                    : (gearIndex % 2 === 1 ? -1 : 1) * radii[0] / radii[gearIndex];
                 const rot = crankDeg * ratio + (gearIndex === radii.length - 1 ? ((m.phase ?? 0) * 180 / Math.PI) : 0);
                 svg += `<g transform="translate(${svgNumber(center.x)}, ${svgNumber(center.y)}) rotate(${svgNumber(rot)})">`;
                 svg += `<path d="${gearPathD(finiteNumber(radii[gearIndex], 1))}" fill="#f59e0b" stroke="#b45309" stroke-width="2" />`;
                 svg += `<circle cx="0" cy="0" r="4" fill="#475569" stroke="white" />`;
                 svg += `</g>`;
             });
        }
        else if (m.type === '5bar' && aux) {
             const rot = (crankDeg * (m.speed2 ?? (m.gearRatio || 1))) + ((m.phase ?? 0) * 180 / Math.PI);
             svg += `<g transform="translate(${svgNumber(p2.x)}, ${svgNumber(p2.y)}) rotate(${svgNumber(rot)})">`;
             svg += `<path d="${gearPathD(finiteNumber(m.rockerLength, 1))}" fill="#f59e0b" stroke="#b45309" stroke-width="2" />`;
             svg += `<circle cx="0" cy="0" r="4" fill="#475569" stroke="white" />`;
             svg += `</g>`;
        }

        // Arms
        svg += `<line x1="${svgNumber(p1.x)}" y1="${svgNumber(p1.y)}" x2="${svgNumber(j1.x)}" y2="${svgNumber(j1.y)}" stroke="#78350f" stroke-width="4" stroke-linecap="round" />`;

        if (m.type === '4bar') {
            svg += `<line x1="${svgNumber(p1.x)}" y1="${svgNumber(p1.y)}" x2="${svgNumber(p2.x)}" y2="${svgNumber(p2.y)}" stroke="#cbd5e1" stroke-width="12" stroke-linecap="round" />`;
            svg += `<line x1="${svgNumber(p2.x)}" y1="${svgNumber(p2.y)}" x2="${svgNumber(j2.x)}" y2="${svgNumber(j2.y)}" stroke="#475569" stroke-width="8" stroke-linecap="round" />`;
            svg += `<path d="M ${svgNumber(j1.x)} ${svgNumber(j1.y)} L ${svgNumber(j2.x)} ${svgNumber(j2.y)} L ${svgNumber(effector.x)} ${svgNumber(effector.y)} Z" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1" />`;
            svg += `<line x1="${svgNumber(j1.x)}" y1="${svgNumber(j1.y)}" x2="${svgNumber(j2.x)}" y2="${svgNumber(j2.y)}" stroke="${color}" stroke-width="8" stroke-linecap="round" />`;
            svg += `<circle cx="${svgNumber(p2.x)}" cy="${svgNumber(p2.y)}" r="8" fill="#94a3b8" stroke="white" stroke-width="2" />`;
        } 
        else if (m.type === '5bar' && aux) {
             svg += `<line x1="${svgNumber(p2.x)}" y1="${svgNumber(p2.y)}" x2="${svgNumber(aux.x)}" y2="${svgNumber(aux.y)}" stroke="#78350f" stroke-width="4" stroke-linecap="round" />`;
             svg += `<line x1="${svgNumber(j1.x)}" y1="${svgNumber(j1.y)}" x2="${svgNumber(effector.x)}" y2="${svgNumber(effector.y)}" stroke="#475569" stroke-width="6" stroke-linecap="round" />`;
	             svg += `<line x1="${svgNumber(aux.x)}" y1="${svgNumber(aux.y)}" x2="${svgNumber(j2.x)}" y2="${svgNumber(j2.y)}" stroke="#475569" stroke-width="6" stroke-linecap="round" />`;
	        }
        else if (m.type === '6bar' && aux) {
            svg += `<line x1="${svgNumber(p1.x)}" y1="${svgNumber(p1.y)}" x2="${svgNumber(p2.x)}" y2="${svgNumber(p2.y)}" stroke="#cbd5e1" stroke-width="12" stroke-linecap="round" />`;
            svg += `<line x1="${svgNumber(p2.x)}" y1="${svgNumber(p2.y)}" x2="${svgNumber(j2.x)}" y2="${svgNumber(j2.y)}" stroke="#475569" stroke-width="8" stroke-linecap="round" />`;
            svg += `<line x1="${svgNumber(j1.x)}" y1="${svgNumber(j1.y)}" x2="${svgNumber(j2.x)}" y2="${svgNumber(j2.y)}" stroke="${color}" stroke-width="8" stroke-linecap="round" />`;
            svg += `<line x1="${svgNumber(j2.x)}" y1="${svgNumber(j2.y)}" x2="${svgNumber(aux.x)}" y2="${svgNumber(aux.y)}" stroke="#64748b" stroke-width="6" stroke-linecap="round" />`;
            svg += `<line x1="${svgNumber(p2.x)}" y1="${svgNumber(p2.y)}" x2="${svgNumber(aux.x)}" y2="${svgNumber(aux.y)}" stroke="#94a3b8" stroke-width="6" stroke-linecap="round" />`;
        }
        else if (m.type === 'piston') {
             svg += `<path d="M ${svgNumber(j1.x)} ${svgNumber(j1.y)} L ${svgNumber(j2.x)} ${svgNumber(j2.y)} L ${svgNumber(effector.x)} ${svgNumber(effector.y)} Z" fill="${color}" fill-opacity="0.2" stroke="${color}" stroke-width="1" />`;
             svg += `<line x1="${svgNumber(j1.x)}" y1="${svgNumber(j1.y)}" x2="${svgNumber(j2.x)}" y2="${svgNumber(j2.y)}" stroke="${color}" stroke-width="8" stroke-linecap="round" />`;
             svg += `<rect x="${svgNumber(j2.x - 20)}" y="${svgNumber(j2.y - 10)}" width="40" height="20" fill="#334155" rx="2" transform="rotate(${svgNumber(m.groundAngle || 0)} ${svgNumber(j2.x)} ${svgNumber(j2.y)})" />`;
        }
        else if (m.type === 'gear') {
            svg += `<line x1="${svgNumber(j1.x)}" y1="${svgNumber(j1.y)}" x2="${svgNumber(effector.x)}" y2="${svgNumber(effector.y)}" stroke="${color}" stroke-width="6" stroke-linecap="round" />`;
            svg += `<line x1="${svgNumber(j2.x)}" y1="${svgNumber(j2.y)}" x2="${svgNumber(effector.x)}" y2="${svgNumber(effector.y)}" stroke="#475569" stroke-width="4" stroke-linecap="round" />`;
        }
        else if (m.type === 'quick-return' || m.type === 'cam' || m.type === 'planetary_gear') {
            svg += `<line x1="${svgNumber(p1.x)}" y1="${svgNumber(p1.y)}" x2="${svgNumber(p2.x)}" y2="${svgNumber(p2.y)}" stroke="#cbd5e1" stroke-width="8" stroke-linecap="round" />`;
            svg += `<line x1="${svgNumber(j2.x)}" y1="${svgNumber(j2.y)}" x2="${svgNumber(effector.x)}" y2="${svgNumber(effector.y)}" stroke="${color}" stroke-width="4" stroke-linecap="round" />`;
            svg += `<path d="M ${svgNumber(p2.x)} ${svgNumber(p2.y)} L ${svgNumber(j2.x)} ${svgNumber(j2.y)} L ${svgNumber(effector.x)} ${svgNumber(effector.y)} Z" fill="${color}" fill-opacity="0.1" />`;
            svg += `<line x1="${svgNumber(p2.x)}" y1="${svgNumber(p2.y)}" x2="${svgNumber(j2.x)}" y2="${svgNumber(j2.y)}" stroke="#475569" stroke-width="10" stroke-linecap="round" />`;
        }

        // Joints
        svg += `<circle cx="${svgNumber(j1.x)}" cy="${svgNumber(j1.y)}" r="4" fill="${color}" />`;
        if (aux) svg += `<circle cx="${svgNumber(aux.x)}" cy="${svgNumber(aux.y)}" r="4" fill="${color}" />`;
        if (j2) svg += `<circle cx="${svgNumber(j2.x)}" cy="${svgNumber(j2.y)}" r="5" fill="white" stroke="#334155" stroke-width="2" />`;
        svg += `<circle cx="${svgNumber(effector.x)}" cy="${svgNumber(effector.y)}" r="6" fill="#ef4444" stroke="white" stroke-width="2" />`;
    });

    svg += `</g></svg>`;
    return svg;
};
