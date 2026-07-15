import type { MechanismConfig, PhysicalKitSettings, ProjectState } from '../types';
import {
  MECHANISM_FEASIBILITY_AUTHORITY_KEYS,
  mechanismEditIsSafe,
} from './mechanismEditAuthority';
import { assessMechanismTargetBinding, MECHANISM_BINDING_BLOCKER } from './pathTargets';

export type MechanismRuntimeGate = {
  canSimulateMechanism: boolean;
  canDriveProject: boolean;
  canProjectScene: boolean;
  canRunBoundPhysics: boolean;
  projection: 'hidden' | 'bound' | 'static-recovery';
  blocker?: string;
  recoveryCandidates: ReturnType<typeof assessMechanismTargetBinding>['recoveryCandidates'];
};

export type ProjectMechanismRuntimeAssessment = {
  gates: ReadonlyMap<string, MechanismRuntimeGate>;
  runtimeMechanisms: MechanismConfig[];
  driverGroups: ReadonlyMap<string, readonly string[]>;
};

export const mechanismIsActive = (mechanism: MechanismConfig) =>
  mechanism.visible && mechanism.enabled !== false;

export const mechanismIsSimulationSafe = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings,
) => mechanismEditIsSafe(mechanism, kit);

export const mechanismIsRuntimeActive = (
  mechanism: MechanismConfig,
  kit: PhysicalKitSettings,
) => mechanismIsActive(mechanism) && mechanismIsSimulationSafe(mechanism, kit);

const valueIsFinite = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(valueIsFinite);
  if (value && typeof value === 'object') return Object.values(value).every(valueIsFinite);
  return true;
};

export const mechanismIsRecoveryProjectable = (mechanism: MechanismConfig) =>
  mechanismIsActive(mechanism) &&
  MECHANISM_FEASIBILITY_AUTHORITY_KEYS.every((key) => valueIsFinite(mechanism[key]));

export const assessProjectMechanismRuntime = (
  project: ProjectState,
  mechanisms: MechanismConfig[] = project.mechanisms,
): ProjectMechanismRuntimeAssessment => {
  const scopeById = new Map(project.mechanisms.map(mechanism => [mechanism.id, mechanism]));
  mechanisms.forEach(mechanism => scopeById.set(mechanism.id, mechanism));
  const assessed = [...scopeById.values()].map(mechanism => ({
    mechanism,
    binding: assessMechanismTargetBinding(project, mechanism),
    canSimulateMechanism: mechanismIsRuntimeActive(mechanism, project.settings.physicalKit),
    canProjectRecovery: mechanismIsRecoveryProjectable(mechanism),
  }));
  const driverGroups = new Map<string, string[]>();
  assessed.forEach(({ mechanism, binding, canSimulateMechanism }) => {
    if (!canSimulateMechanism || !binding.valid || !binding.driverKey) return;
    driverGroups.set(binding.driverKey, [
      ...(driverGroups.get(binding.driverKey) ?? []),
      mechanism.id,
    ]);
  });
  const gates = new Map<string, MechanismRuntimeGate>();
  assessed.forEach(({ mechanism, binding, canSimulateMechanism, canProjectRecovery }) => {
    const duplicateDriver = Boolean(
      binding.driverKey && (driverGroups.get(binding.driverKey)?.length ?? 0) > 1,
    );
    const canDriveProject = canSimulateMechanism && binding.valid && !duplicateDriver;
    const canProjectScene = canDriveProject || canProjectRecovery;
    gates.set(mechanism.id, {
      canSimulateMechanism,
      canDriveProject,
      canProjectScene,
      canRunBoundPhysics: canDriveProject,
      projection: !canProjectScene
        ? 'hidden'
        : canDriveProject
          ? 'bound'
          : 'static-recovery',
      blocker: !canSimulateMechanism
        ? 'Fix mechanism geometry'
        : canDriveProject
          ? undefined
          : MECHANISM_BINDING_BLOCKER,
      recoveryCandidates: binding.recoveryCandidates,
    });
  });
  return {
    gates,
    runtimeMechanisms: mechanisms.filter(mechanism => gates.get(mechanism.id)?.canDriveProject),
    driverGroups,
  };
};

export const resolveMechanismRuntimeGate = (
  project: ProjectState,
  mechanism: MechanismConfig,
): MechanismRuntimeGate => assessProjectMechanismRuntime(project, [mechanism]).gates.get(mechanism.id)!;

export const runtimeMechanisms = (
  project: ProjectState,
  mechanisms: MechanismConfig[] = project.mechanisms,
) => assessProjectMechanismRuntime(project, mechanisms).runtimeMechanisms;

export const mechanismRuntimeWarnings = (
  project: ProjectState,
  mechanisms: MechanismConfig[] = project.mechanisms,
): Record<string, string[]> => {
  const assessment = assessProjectMechanismRuntime(project, mechanisms);
  const warnings: Record<string, string[]> = {};
  mechanisms.forEach(mechanism => {
    const gate = assessment.gates.get(mechanism.id);
    if (gate?.projection === 'static-recovery') {
      warnings[mechanism.id] = [gate.blocker ?? MECHANISM_BINDING_BLOCKER];
    }
  });
  return warnings;
};
