import type { BodyPartLayer, Point, ProjectState } from '../types';
import { bodyPartPivotScene, sceneToBoardRaw } from './coordinates';
import { fabricablePartOutlinePoints, partLandmarkJointIds, partLandmarkLocalPoints } from './partGeometry';
import type {
    BuildPlanCharacterPinV1,
    BuildPlanCharacterV1,
    BuildPlanPartV1,
    BuildPlanSectionV1,
    BuildPlanStepV1
} from './buildPlanTypes';

const characterPartRef = (partId: string) => `character:part:${encodeURIComponent(partId)}`;
const characterPinRef = (role: BuildPlanCharacterPinV1['role'], jointId: string) =>
    `character:pin:${role}:${encodeURIComponent(jointId)}`;

const transformPartLocalPoint = (part: BodyPartLayer, point: Point): Point => {
    const angle = (part.transform.rotation * Math.PI) / 180;
    const scale = part.transform.scale || 1;
    const x = point.x * scale;
    const y = point.y * scale;
    return {
        x: part.transform.x + x * Math.cos(angle) - y * Math.sin(angle),
        y: part.transform.y + x * Math.sin(angle) + y * Math.cos(angle)
    };
};

const titleCaseJointLabel = (jointId: string) =>
    jointId.replace(/[_-]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());

export type CharacterBuildSectionV1 = {
    character: BuildPlanCharacterV1;
    parts: BuildPlanPartV1[];
    steps: BuildPlanStepV1[];
    section: BuildPlanSectionV1;
};

const emptyCharacterSection = (boardCells: number): CharacterBuildSectionV1 => {
    const character: BuildPlanCharacterV1 = {
        id: 'character',
        parts: [],
        fixedPins: [],
        freePivots: [],
        partRefs: [],
        pinRefs: [],
        stepIds: [],
        boardCells
    };
    return {
        character,
        parts: [],
        steps: [],
        section: { id: 'character', kind: 'character', label: 'Character', partRefs: [], stepIds: [] }
    };
};

export const buildCharacterBuildSectionV1 = (project: ProjectState): CharacterBuildSectionV1 => {
    const skeleton = project.skeleton;
    if (!skeleton) return emptyCharacterSection(project.settings.physicalKit.boardCells);

    const visibleParts = project.partOrder
        .map(id => project.parts[id])
        .filter((part): part is BodyPartLayer => Boolean(part) && part.visible !== false);
    const jointToParts = new Map<string, BodyPartLayer[]>();
    for (const part of visibleParts) {
        const jointIds = new Set([part.anchorJointId, ...partLandmarkJointIds(part, skeleton)]);
        for (const jointId of jointIds) {
            if (!skeleton.joints[jointId]) continue;
            const parts = jointToParts.get(jointId) ?? [];
            parts.push(part);
            jointToParts.set(jointId, parts);
        }
    }

    const anchorJointIds = [...new Set(
        visibleParts.map(part => part.anchorJointId).filter(jointId => Boolean(skeleton.joints[jointId]))
    )];
    const fixedJointIds = [...new Set([
        ...anchorJointIds.filter(jointId => skeleton.joints[jointId]?.locked),
        'hip',
        'torso',
        ...skeleton.rootJointIds,
        anchorJointIds[0]
    ].filter((jointId): jointId is string => Boolean(jointId && skeleton.joints[jointId])))]
        .slice(0, Math.min(2, Math.max(1, anchorJointIds.length)));
    const fixedSet = new Set(fixedJointIds);
    const createPin = (jointId: string, role: BuildPlanCharacterPinV1['role']): BuildPlanCharacterPinV1 => {
        const joint = skeleton.joints[jointId];
        const parts = jointToParts.get(jointId) ?? visibleParts.filter(part => part.anchorJointId === jointId);
        const board = role === 'fixed_pin' ? sceneToBoardRaw(joint.position, project.settings.physicalKit) : undefined;
        return {
            id: `${role}-${jointId}`,
            ref: characterPinRef(role, jointId),
            jointId,
            label: joint.name || titleCaseJointLabel(jointId),
            role,
            scene: { ...joint.position },
            boardCoordinate: board?.valid ? board.label : undefined,
            board: board ? { ...board } : undefined,
            partIds: [...new Set(parts.map(part => part.id))],
            partNames: [...new Set(parts.map(part => part.name))],
            stack: role === 'fixed_pin'
                ? ['board', 'paper fastener', 'spacer', 'character part', 'retaining clip']
                : ['character part', 'free washer', 'retaining clip']
        };
    };
    const fixedPins = fixedJointIds.map(jointId => createPin(jointId, 'fixed_pin'));
    const freePivots = anchorJointIds
        .filter(jointId => !fixedSet.has(jointId))
        .map(jointId => createPin(jointId, 'free_pivot'));

    const characterParts = visibleParts.map(part => {
        const localJoints = partLandmarkLocalPoints(part, skeleton);
        const outline = fabricablePartOutlinePoints(part, localJoints)
            .map(point => transformPartLocalPoint(part, point));
        if (outline.length < 3) return null;
        return {
            id: part.id,
            ref: characterPartRef(part.id),
            sourcePartId: part.id,
            name: part.name,
            fillColor: part.fillColor ?? '#cbd5e1',
            outline,
            pivot: bodyPartPivotScene(part, skeleton)
        };
    }).filter((part): part is NonNullable<typeof part> => Boolean(part));
    const partRefsById = new Map(characterParts.map(part => [part.sourcePartId, part.ref]));
    const buildParts: BuildPlanPartV1[] = characterParts.map(part => ({
        ref: part.ref,
        kind: 'character',
        name: part.name,
        displayName: part.name,
        quantity: 1,
        sourcePartId: part.sourcePartId
    }));

    const stepSpecs = characterParts.length ? [
        { index: 1, label: 'Parts', phase: 'character-parts' as const, action: 'layout-parts', pinIds: [] as string[], instruction: 'Lay out character parts.', check: `${characterParts.length} parts.` },
        { index: 2, label: 'Fixed pins', phase: 'fixed-pins' as const, action: 'pin-to-board', pinIds: fixedPins.map(pin => pin.id), instruction: 'Pin fixed joints to the board.', check: `${fixedPins.length} fixed.` },
        { index: 3, label: 'Free pivots', phase: 'free-pivots' as const, action: 'leave-free', pinIds: freePivots.map(pin => pin.id), instruction: 'Keep limb pivots free.', check: `${freePivots.length} free.` },
        { index: 4, label: 'Attach character', phase: 'attach-character' as const, action: 'stack-character', pinIds: [...fixedPins, ...freePivots].map(pin => pin.id), instruction: 'Stack spacer, part, clip.', check: 'No blocked pivots.' },
        { index: 5, label: 'Test character', phase: 'test-character' as const, action: 'test-motion', pinIds: [...fixedPins, ...freePivots].map(pin => pin.id), instruction: 'Scrub once.', check: 'Fixed pins stay put.' }
    ] : [];
    const pinsById = new Map([...fixedPins, ...freePivots].map(pin => [pin.id, pin]));
    const steps: BuildPlanStepV1[] = stepSpecs.map(spec => {
        const pins = spec.pinIds.flatMap(id => pinsById.get(id) ?? []);
        const partRefs = spec.phase === 'character-parts'
            ? characterParts.map(part => part.ref)
            : [...new Set(pins.flatMap(pin => pin.partIds).flatMap(id => partRefsById.get(id) ?? []))];
        const fixedPinCoords = spec.phase === 'fixed-pins'
            ? fixedPins.flatMap(pin => pin.boardCoordinate ?? [])
            : [];
        return {
            id: `character:step:${spec.index}:${encodeURIComponent(spec.action)}`,
            order: spec.index,
            index: spec.index,
            sectionId: 'character',
            scope: 'character',
            sourceStepIndex: spec.index,
            label: spec.label,
            phase: spec.phase,
            motion: spec.phase === 'test-character' ? 'scrub_time' : spec.phase === 'attach-character' ? 'explode_z' : 'none',
            action: spec.action,
            coords: fixedPinCoords,
            coordRoles: fixedPinCoords.map(() => 'board-pin'),
            zMm: 0,
            instruction: spec.instruction,
            check: spec.check,
            stack: [],
            partRefs,
            pinIds: [...spec.pinIds]
        };
    });
    const partRefs = characterParts.map(part => part.ref);
    const pinRefs = [...fixedPins, ...freePivots].map(pin => pin.ref);
    const stepIds = steps.map(step => step.id);
    const character: BuildPlanCharacterV1 = {
        id: 'character',
        parts: characterParts,
        fixedPins,
        freePivots,
        partRefs,
        pinRefs,
        stepIds,
        boardCells: project.settings.physicalKit.boardCells
    };
    return {
        character,
        parts: buildParts,
        steps,
        section: { id: 'character', kind: 'character', label: 'Character', partRefs, stepIds }
    };
};

