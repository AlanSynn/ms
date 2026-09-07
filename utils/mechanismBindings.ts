import type {
    MechanismConfig,
    MechanismOutputBinding,
    MechanismOutputPort,
    MechanismPathFitMetadata,
    MechanismType,
    ProjectMotionPath,
    ProjectState,
} from '../types';

/** Existing authored bindings that this same mechanism would lose on commit. */
export const replacedMechanismPathIds = (project: ProjectState, candidate: MechanismConfig): string[] => {
    const current = project.mechanisms.find(mechanism => mechanism.id === candidate.id);
    if (!current) return [];
    const retained = new Set(mechanismOutputBindings(candidate).map(binding => binding.pathId));
    return [...new Set(mechanismOutputBindings(current)
        .map(binding => binding.pathId).filter(id => id && !retained.has(id)))];
};

/** Foundry preview clones keep their binding even when their local ID changes. */
export const mechanismOwnerForDraft = (project: ProjectState, draft: MechanismConfig): MechanismConfig | undefined => {
    const exact = project.mechanisms.find(mechanism => mechanism.id === draft.id);
    if (exact) return exact;
    const bindingIds = new Set((draft.outputs ?? []).map(binding => binding.id));
    const pathIds = new Set([draft.targetPathId, ...mechanismOutputBindings(draft).map(binding => binding.pathId)].filter(Boolean));
    const owners = project.mechanisms.filter(mechanism => mechanismOutputBindings(mechanism)
        .some(binding => bindingIds.has(binding.id) || pathIds.has(binding.pathId)));
    return owners.length === 1 ? owners[0] : undefined;
};

const port = (id: string, label: string, primary = false): MechanismOutputPort & { primary?: boolean } => ({
    id,
    label,
    outputTraceId: id,
    capacity: 1,
    fabricable: true,
    ...(primary ? { primary: true } : {}),
});

const OUTPUT_PORTS = {
    crank: [port('B', 'Crank pin', true)],
    '4bar': [port('B', 'Crank joint'), port('C', 'Output joint', true)],
    piston: [port('B', 'Crank pin'), port('C', 'Slider output', true)],
    yoke: [port('B', 'Crank pin'), port('C', 'Yoke output', true)],
    'quick-return': [port('B', 'Crank pin'), port('C', 'Slider output', true)],
    '5bar': [port('B', 'Left crank joint'), port('C', 'Coupler joint', true), port('D', 'Right crank joint')],
    '6bar': [port('B', 'Input crank joint'), port('C', 'Four-bar joint'), port('E', 'Follower joint', true)],
    cam: [port('B', 'Cam contact'), port('C', 'Follower', true)],
    'rack-pinion': [port('B', 'Pinion point'), port('C', 'Rack output', true)],
    gear: [port('B', 'Drive point'), port('C', 'Output point', true)],
    gear_linkage: [port('B', 'Drive crank pin'), port('C', 'Output crank pin'), port('R', 'Shared link output', true)],
    planetary_gear: [port('B', 'Drive point'), port('C', 'Carrier', true), port('D', 'Planet pitch point')],
} satisfies Record<MechanismType, ReadonlyArray<MechanismOutputPort & { primary?: boolean }>>;

export const mechanismOutputPortsForType = (type: MechanismType): readonly MechanismOutputPort[] =>
    OUTPUT_PORTS[type];

export const primaryMechanismOutputPort = (type: MechanismType): MechanismOutputPort => {
    const ports = OUTPUT_PORTS[type];
    return ports.find(candidate => candidate.primary) ?? ports[0];
};

export const mechanismOutputPortForBinding = (
    mechanism: Pick<MechanismConfig, 'type'>,
    binding: Pick<MechanismOutputBinding, 'portId' | 'outputTraceId'>,
) => mechanismOutputPortsForType(mechanism.type).find(candidate =>
    candidate.id === binding.portId || candidate.outputTraceId === binding.outputTraceId
);

const legacyBinding = (mechanism: MechanismConfig): MechanismOutputBinding | undefined => {
    if (!mechanism.targetPathId) return undefined;
    const fit = mechanism.fabricationMetadata?.pathFit;
    const selectedPort = mechanismOutputPortsForType(mechanism.type).find(candidate =>
        candidate.outputTraceId === fit?.outputTraceId
    ) ?? primaryMechanismOutputPort(mechanism.type);
    return {
        id: `${mechanism.id}:output-1`,
        portId: selectedPort.id,
        pathId: mechanism.targetPathId,
        targetPartId: mechanism.targetPartId,
        targetSceneObjectId: mechanism.targetSceneObjectId,
        targetAnchorJointId: mechanism.targetAnchorJointId,
        outputTraceId: selectedPort.outputTraceId,
        phaseOffset: fit?.phaseOffset,
        direction: fit?.direction,
        enabled: true,
        fit,
    };
};

/**
 * The only scalar-target migration adapter. New code consumes bindings; the
 * scalar target fields remain a compatibility mirror of the primary binding.
 */
export const mechanismOutputBindings = (mechanism: MechanismConfig): MechanismOutputBinding[] => {
    const source = mechanism.outputs?.length ? mechanism.outputs : [legacyBinding(mechanism)].filter(Boolean) as MechanismOutputBinding[];
    return source.map((binding, index) => {
        const requestedPortId = binding.portId || binding.outputTraceId || binding.fit?.outputTraceId;
        const declaredPort = mechanismOutputPortsForType(mechanism.type).find(candidate =>
            candidate.id === requestedPortId || candidate.outputTraceId === requestedPortId
        );
        const fallbackPort = primaryMechanismOutputPort(mechanism.type);
        const isLegacyPrimary = index === 0 && binding.pathId === mechanism.targetPathId;
        return {
            ...binding,
            id: binding.id || `${mechanism.id}:output-${index + 1}`,
            portId: requestedPortId || fallbackPort.id,
            outputTraceId: binding.outputTraceId ?? declaredPort?.outputTraceId ?? fallbackPort.outputTraceId,
            targetPartId: binding.targetPartId ?? (isLegacyPrimary ? mechanism.targetPartId : undefined),
            targetSceneObjectId: binding.targetSceneObjectId ?? (isLegacyPrimary ? mechanism.targetSceneObjectId : undefined),
            targetAnchorJointId: binding.targetAnchorJointId ?? (isLegacyPrimary ? mechanism.targetAnchorJointId : undefined),
            phaseOffset: binding.phaseOffset ?? binding.fit?.phaseOffset,
            direction: binding.direction ?? binding.fit?.direction,
            enabled: binding.enabled !== false,
        };
    });
};

const targetForPath = (path: ProjectMotionPath) => path.sceneObjectId
    ? { targetPartId: undefined, targetSceneObjectId: path.sceneObjectId, targetAnchorJointId: undefined }
    : {
        targetPartId: path.partId,
        targetSceneObjectId: undefined,
        targetAnchorJointId: path.targetAnchorJointId,
    };

export const resolvedMechanismOutputBindings = (
    project: Pick<ProjectState, 'paths'>,
    mechanism: MechanismConfig,
): MechanismOutputBinding[] => mechanismOutputBindings(mechanism).map(binding => {
    const path = project.paths[binding.pathId];
    if (!path) return binding;
    if (path.sceneObjectId) return { ...binding, ...targetForPath(path) };
    return {
        ...binding,
        targetPartId: binding.targetPartId ?? path.partId,
        targetSceneObjectId: undefined,
        targetAnchorJointId: binding.targetAnchorJointId ?? path.targetAnchorJointId,
    };
});

export const mechanismWithOutputBindings = (
    mechanism: MechanismConfig,
    bindings: MechanismOutputBinding[],
): MechanismConfig => {
    const outputs = bindings.map(binding => ({ ...binding }));
    const primary = outputs.find(binding => binding.enabled !== false) ?? outputs[0];
    const priorPrimaryFit = primary?.pathId === mechanism.targetPathId
        ? mechanism.fabricationMetadata?.pathFit
        : undefined;
    const primaryFit = primary?.fit ?? priorPrimaryFit;
    const activeVisualPartIds = [...new Set(outputs.flatMap(binding =>
        binding.targetPartId ? [binding.targetPartId] : []
    ))];
    return {
        ...mechanism,
        ...(outputs.length || mechanism.outputs !== undefined ? { outputs } : {}),
        targetPartId: primary?.targetPartId ?? (outputs.length ? undefined : mechanism.targetPartId),
        targetSceneObjectId: primary?.targetSceneObjectId ?? (outputs.length ? undefined : mechanism.targetSceneObjectId),
        targetPathId: primary?.pathId ?? (outputs.length ? undefined : mechanism.targetPathId),
        targetAnchorJointId: primary?.targetAnchorJointId ?? (outputs.length ? undefined : mechanism.targetAnchorJointId),
        activeVisualPartIds: outputs.length ? activeVisualPartIds : mechanism.activeVisualPartIds,
        fabricationMetadata: {
            ...(mechanism.fabricationMetadata ?? {}),
            targetPathId: primary?.pathId,
            pathFit: primary
                ? primaryFit
                    ? { ...primaryFit, targetPathId: primary.pathId, outputTraceId: primary.outputTraceId }
                    : undefined
                : mechanism.fabricationMetadata?.pathFit,
        },
    };
};

export const mechanismWithoutOutputBindings = (
    mechanism: MechanismConfig,
    remove: (binding: MechanismOutputBinding) => boolean,
): MechanismConfig => {
    const remaining = mechanismOutputBindings(mechanism).filter(binding => !remove(binding));
    if (remaining.length === mechanismOutputBindings(mechanism).length) return mechanism;
    const cleared = remaining.length ? mechanism : {
        ...mechanism,
        targetPartId: undefined,
        targetSceneObjectId: undefined,
        targetPathId: undefined,
        targetAnchorJointId: undefined,
        activeVisualPartIds: [],
        fabricationMetadata: {
            ...(mechanism.fabricationMetadata ?? {}),
            targetPathId: undefined,
            pathFit: undefined,
        },
    };
    return mechanismWithOutputBindings(cleared, remaining);
};

export const mechanismBindingForPath = (
    project: Pick<ProjectState, 'paths'>,
    mechanism: MechanismConfig,
    pathId: string,
    options: {
        id?: string;
        portId?: string;
        outputTraceId?: string;
        targetPartId?: string;
        targetSceneObjectId?: string;
        targetAnchorJointId?: string;
        phaseOffset?: number;
        direction?: 1 | -1;
        fit?: MechanismPathFitMetadata;
    } = {},
): MechanismOutputBinding | undefined => {
    const path = project.paths[pathId];
    if (!path) return undefined;
    const requestedPortId = options.portId ?? options.outputTraceId ?? options.fit?.outputTraceId;
    const selectedPort = requestedPortId
        ? mechanismOutputPortsForType(mechanism.type).find(candidate =>
            candidate.id === requestedPortId || candidate.outputTraceId === requestedPortId
        )
        : primaryMechanismOutputPort(mechanism.type);
    if (!selectedPort?.fabricable) return undefined;
    const pathTarget = targetForPath(path);
    const target = options.targetSceneObjectId
        ? {
            targetPartId: undefined,
            targetSceneObjectId: options.targetSceneObjectId,
            targetAnchorJointId: undefined,
        }
        : options.targetPartId
            ? {
                targetPartId: options.targetPartId,
                targetSceneObjectId: undefined,
                targetAnchorJointId: options.targetAnchorJointId ?? pathTarget.targetAnchorJointId,
            }
            : {
                ...pathTarget,
                targetAnchorJointId: options.targetAnchorJointId ?? pathTarget.targetAnchorJointId,
            };
    return {
        id: options.id ?? `${mechanism.id}:binding:${path.id}`,
        portId: selectedPort.id,
        pathId: path.id,
        ...target,
        outputTraceId: selectedPort.outputTraceId,
        phaseOffset: options.phaseOffset ?? options.fit?.phaseOffset,
        direction: options.direction ?? options.fit?.direction,
        enabled: true,
        fit: options.fit ? { ...options.fit, targetPathId: path.id, outputTraceId: selectedPort.outputTraceId } : undefined,
    };
};

export const replacePrimaryMechanismOutputBinding = (
    project: Pick<ProjectState, 'paths'>,
    mechanism: MechanismConfig,
    pathId?: string,
    options: Parameters<typeof mechanismBindingForPath>[3] = {},
): MechanismConfig => {
    const current = mechanismOutputBindings(mechanism);
    if (!pathId) return mechanismWithOutputBindings({
        ...mechanism,
        targetPartId: undefined,
        targetSceneObjectId: undefined,
        targetPathId: undefined,
        targetAnchorJointId: undefined,
    }, current.slice(1));
    const prior = current[0];
    const next = mechanismBindingForPath(project, mechanism, pathId, {
        id: prior?.id,
        portId: options.portId ?? prior?.portId,
        outputTraceId: options.outputTraceId ?? prior?.outputTraceId,
        phaseOffset: options.phaseOffset ?? prior?.phaseOffset,
        direction: options.direction ?? prior?.direction,
        fit: options.fit ?? (prior?.pathId === pathId ? prior.fit : undefined),
    });
    return next ? mechanismWithOutputBindings(mechanism, [next, ...current.slice(1)]) : mechanism;
};

export const mechanismBindingTargetKey = (
    project: Pick<ProjectState, 'paths'>,
    binding: MechanismOutputBinding,
) => {
    const path = project.paths[binding.pathId];
    const sceneObjectId = binding.targetSceneObjectId ?? path?.sceneObjectId;
    if (sceneObjectId) return `object:${sceneObjectId}`;
    const partId = binding.targetPartId ?? path?.partId;
    if (!partId) return undefined;
    return `part:${partId}:${binding.targetAnchorJointId ?? path?.targetAnchorJointId ?? ''}`;
};

export type MechanismBindingAssignmentResult =
    | { ok: true; project: ProjectState; mechanismId: string; binding: MechanismOutputBinding }
    | { ok: false; project: ProjectState; code: 'missing-mechanism' | 'missing-path' | 'unknown-port' | 'port-capacity' | 'path-conflict' | 'target-conflict'; reason: string };

export const assignMechanismOutputBinding = (
    project: ProjectState,
    mechanismId: string,
    requestedBinding: MechanismOutputBinding,
): MechanismBindingAssignmentResult => {
    const mechanism = project.mechanisms.find(candidate => candidate.id === mechanismId);
    if (!mechanism) return { ok: false, project, code: 'missing-mechanism', reason: 'Mechanism is no longer available.' };
    if (!project.paths[requestedBinding.pathId]) return { ok: false, project, code: 'missing-path', reason: 'Motion path is no longer available.' };
    const binding = mechanismBindingForPath(project, mechanism, requestedBinding.pathId, {
        ...requestedBinding,
        fit: requestedBinding.fit,
    });
    if (!binding) return { ok: false, project, code: 'unknown-port', reason: 'That output is not fabricable on this mechanism.' };

    const current = resolvedMechanismOutputBindings(project, mechanism);
    const replaceIndex = current.findIndex(candidate =>
        candidate.id === binding.id || candidate.pathId === binding.pathId
    );
    const targetKey = mechanismBindingTargetKey(project, binding);
    for (const candidateMechanism of project.mechanisms) {
        for (const candidateBinding of resolvedMechanismOutputBindings(project, candidateMechanism)) {
            if (candidateMechanism.id === mechanism.id && current[replaceIndex]?.id === candidateBinding.id) continue;
            if (candidateBinding.pathId === binding.pathId) {
                return { ok: false, project, code: 'path-conflict', reason: `Motion ${binding.pathId} already has a mechanism output.` };
            }
            if (targetKey && mechanismBindingTargetKey(project, candidateBinding) === targetKey) {
                return { ok: false, project, code: 'target-conflict', reason: `Target ${targetKey} already has a mechanism output.` };
            }
        }
    }

    const selectedPort = mechanismOutputPortForBinding(mechanism, binding);
    if (!selectedPort) return { ok: false, project, code: 'unknown-port', reason: `Output ${binding.portId} is unavailable.` };
    const occupied = current.filter((candidate, index) =>
        index !== replaceIndex && candidate.portId === selectedPort.id
    ).length;
    if (occupied >= selectedPort.capacity) {
        return { ok: false, project, code: 'port-capacity', reason: `${selectedPort.label} is already attached.` };
    }

    const outputs = replaceIndex >= 0
        ? current.map((candidate, index) => index === replaceIndex ? binding : candidate)
        : [...current, binding];
    const nextMechanism = mechanismWithOutputBindings(mechanism, outputs);
    return {
        ok: true,
        project: {
            ...project,
            paths: project.paths,
            mechanisms: project.mechanisms.map(candidate => candidate.id === mechanism.id ? nextMechanism : candidate),
            selectedMechanismId: mechanism.id,
        },
        mechanismId: mechanism.id,
        binding,
    };
};

const PHYSICAL_CONFIGURATION_KEYS: Array<keyof MechanismConfig> = [
    'anchorX', 'anchorY', 'groundAngle', 'groundLength', 'crankLength', 'couplerLength',
    'rockerLength', 'sliderOffset', 'couplerPointDist', 'couplerPointAngle', 'assemblyMode',
    'speed1', 'speed2', 'gearRatio', 'gearTrainRadii', 'camProfileSamples', 'rodLength',
    'phase', 'showOutputGear', 'outputGearRadius',
];

const samePhysicalValue = (left: unknown, right: unknown): boolean => {
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
            left.every((value, index) => samePhysicalValue(value, right[index]));
    }
    if (typeof left === 'number' || typeof right === 'number') {
        return typeof left === 'number' && typeof right === 'number' &&
            Math.abs(left - right) <= Math.max(1e-6, Math.max(Math.abs(left), Math.abs(right)) * 1e-6);
    }
    return left === right;
};

export const mechanismsSharePhysicalConfiguration = (left: MechanismConfig, right: MechanismConfig) =>
    left.type === right.type && PHYSICAL_CONFIGURATION_KEYS.every(key => samePhysicalValue(left[key], right[key]));

export const compatibleMechanismsForBinding = (
    project: ProjectState,
    draft: MechanismConfig,
    pathId: string,
    portId?: string,
    options: { ignoreMechanismId?: string } = {},
) => {
    const requestedPort = portId
        ? mechanismOutputPortsForType(draft.type).find(candidate => candidate.id === portId || candidate.outputTraceId === portId)
        : primaryMechanismOutputPort(draft.type);
    if (!requestedPort) return [];
    const pathOwnedElsewhere = project.mechanisms.some(mechanism =>
        mechanism.id !== options.ignoreMechanismId &&
        resolvedMechanismOutputBindings(project, mechanism).some(binding => binding.pathId === pathId)
    );
    if (pathOwnedElsewhere) return [];
    return project.mechanisms.flatMap(mechanism => {
        if (mechanism.id === options.ignoreMechanismId || !mechanismsSharePhysicalConfiguration(mechanism, draft)) return [];
        const portContract = mechanismOutputPortsForType(mechanism.type).find(candidate => candidate.id === requestedPort.id);
        if (!portContract?.fabricable) return [];
        const occupied = resolvedMechanismOutputBindings(project, mechanism).filter(binding => binding.portId === portContract.id).length;
        return occupied < portContract.capacity ? [{ mechanism, port: portContract }] : [];
    });
};

export type MechanismOutputAllocationResult =
    | { ok: true; project: ProjectState; mechanismId: string; binding: MechanismOutputBinding; createdIndependent: boolean; reuseRejected: boolean }
    | Extract<MechanismBindingAssignmentResult, { ok: false }>;

export const allocateMechanismOutput = (
    project: ProjectState,
    draft: MechanismConfig,
    pathId: string,
    options: {
        reuseMechanismId?: string;
        portId?: string;
        fit?: MechanismPathFitMetadata;
    } = {},
): MechanismOutputAllocationResult => {
    if (!project.paths[pathId]) return { ok: false, project, code: 'missing-path', reason: 'Motion path is no longer available.' };
    if (options.reuseMechanismId) {
        const reusable = compatibleMechanismsForBinding(project, draft, pathId, options.portId)
            .find(candidate => candidate.mechanism.id === options.reuseMechanismId);
        if (reusable) {
            const binding = mechanismBindingForPath(project, reusable.mechanism, pathId, {
                portId: reusable.port.id,
                fit: options.fit,
            });
            if (binding) {
                const assigned = assignMechanismOutputBinding(project, reusable.mechanism.id, binding);
                if (assigned.ok) return { ...assigned, createdIndependent: false, reuseRejected: false };
            }
        }
    }

    let mechanismId = draft.id;
    let suffix = 2;
    while (project.mechanisms.some(candidate => candidate.id === mechanismId)) {
        mechanismId = `${draft.id}-${suffix}`;
        suffix += 1;
    }
    const unbound = mechanismWithOutputBindings({
        ...draft,
        id: mechanismId,
        outputs: [],
        targetPartId: undefined,
        targetSceneObjectId: undefined,
        targetPathId: undefined,
        targetAnchorJointId: undefined,
    }, []);
    const binding = mechanismBindingForPath(project, unbound, pathId, {
        portId: options.portId,
        fit: options.fit,
    });
    if (!binding) return { ok: false, project, code: 'unknown-port', reason: 'That output is not fabricable on this mechanism.' };
    const staged = { ...project, mechanisms: [...project.mechanisms, unbound] };
    const assigned = assignMechanismOutputBinding(staged, unbound.id, binding);
    return assigned.ok
        ? { ...assigned, createdIndependent: true, reuseRejected: Boolean(options.reuseMechanismId) }
        : { ...assigned, project };
};
