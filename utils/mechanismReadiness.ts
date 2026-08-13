import type { MechanismConfig, MechanismRecoveryCandidates, MechanismType, ProjectState } from '../types';
import { validateFabricationStack } from './fabricationStackModel';
import { compactStudentActionForFabricationDiagnostic } from './fabricationReadiness';
import { mechanismSafetyPhaseSchedule } from './kinematics';
import {
  mechanismDescriptorFitsCutSheet,
  mechanismDescriptorWithinBoard,
  synchronizedMechanismCollisionOracle,
} from './mechanismCollision';
import { compileMechanismGraphFabrication } from './mechanismCompiler';
import { buildMechanismPhysicalEnvelopeDescriptors } from './mechanismPhysicalEnvelope';
import { isReferenceExportReady, referenceSupportWarning } from './mechanismReference';
import {
  assessProjectMechanismRuntime,
  mechanismIsActive,
  resolveMechanismRuntimeGate,
  type MechanismRuntimeGate,
} from './mechanismRuntimePolicy';
import { MECHANISM_BINDING_BLOCKER } from './pathTargets';

export type MechanismReadinessStatus =
  | 'simulation-safe'
  | 'fabrication-ready'
  | 'fabrication-unsupported'
  | 'recovery-blocked';

export type MechanismReadinessResult = {
  mechanismId: string;
  mechanismType: MechanismType;
  status: MechanismReadinessStatus;
  simulationSafe: boolean;
  fabricationReady: boolean;
  blockers: string[];
  recoveryCandidates?: MechanismRecoveryCandidates;
};

export type ProjectReadinessResult = {
  status: 'project-ready' | 'blocked';
  activeMechanismIds: string[];
  mechanisms: MechanismReadinessResult[];
  blockers: string[];
};

export const mechanismIsActiveForReadiness = mechanismIsActive;

export const activeMechanismsForReadiness = (project: ProjectState) =>
  project.mechanisms.filter(mechanismIsActiveForReadiness);

const unique = (values: string[]) => [...new Set(values)];

export const mechanismReadiness = (
  project: ProjectState,
  mechanism: MechanismConfig,
  runtimeGate: MechanismRuntimeGate = resolveMechanismRuntimeGate(project, mechanism),
): MechanismReadinessResult => {
  const common = { mechanismId: mechanism.id, mechanismType: mechanism.type };
  const gate = runtimeGate;
  if (!gate.canSimulateMechanism) {
    const compilerBlockers = isReferenceExportReady(mechanism.type)
      ? (() => {
          const compiled = compileMechanismGraphFabrication(mechanism, project.settings.physicalKit);
          return [
            ...(compiled.blocker ? [compiled.blocker] : []),
            ...compiled.renderPlan.validationErrors,
            ...validateFabricationStack(mechanism),
          ];
        })()
      : [];
    return {
      ...common,
      status: 'recovery-blocked',
      simulationSafe: false,
      fabricationReady: false,
      blockers: unique(['Fix mechanism geometry', ...compilerBlockers]),
    };
  }

  if (!gate.canDriveProject) {
    return {
      ...common,
      status: 'recovery-blocked',
      simulationSafe: false,
      fabricationReady: false,
      blockers: [gate.blocker ?? MECHANISM_BINDING_BLOCKER],
      recoveryCandidates: gate.recoveryCandidates,
    };
  }

  const blockers: string[] = [];
  const simulationSafe = true;

  if (!isReferenceExportReady(mechanism.type)) {
    return {
      ...common,
      status: 'fabrication-unsupported',
      simulationSafe,
      fabricationReady: false,
      blockers: unique([
        ...blockers,
        referenceSupportWarning(mechanism.type) ?? `${mechanism.type}: not fabrication-ready`,
      ]),
    };
  }

  const compiled = compileMechanismGraphFabrication(mechanism, project.settings.physicalKit);
  if (!compiled.buildable || !compiled.recipe) {
    blockers.push(compiled.blocker ?? 'Graph fabrication blocked');
  }
  blockers.push(...compiled.renderPlan.validationErrors, ...validateFabricationStack(mechanism));

  if (compiled.buildable && compiled.recipe && compiled.renderPlan.validationErrors.length === 0) {
    const phases = mechanismSafetyPhaseSchedule(mechanism.type);
    const descriptors = buildMechanismPhysicalEnvelopeDescriptors(
      mechanism,
      phases,
      compiled.renderPlan,
      project.settings.physicalKit,
    );
    const coveredPhases = new Set(descriptors.map(descriptor => descriptor.phaseIndex));
    if (!descriptors.length || coveredPhases.size !== phases.length) blockers.push('Physical envelope incomplete');
    if (descriptors.some(descriptor => !mechanismDescriptorWithinBoard(descriptor, project.settings.physicalKit))) {
      blockers.push('Physical envelope outside board');
    }
    if (descriptors.some(descriptor => !mechanismDescriptorFitsCutSheet(descriptor, project.settings.physicalKit))) {
      blockers.push('Physical envelope outside sheet');
    }
  }

  const readyBlockers = unique(blockers);
  return {
    ...common,
    status: readyBlockers.length ? 'simulation-safe' : 'fabrication-ready',
    simulationSafe,
    fabricationReady: readyBlockers.length === 0,
    blockers: readyBlockers,
  };
};

export const projectMechanismReadiness = (project: ProjectState): ProjectReadinessResult => {
  const active = activeMechanismsForReadiness(project);
  const assessment = assessProjectMechanismRuntime(project, active);
  const mechanisms = active.map(mechanism =>
    mechanismReadiness(project, mechanism, assessment.gates.get(mechanism.id)),
  );
  const blockers = mechanisms.flatMap(result =>
    result.fabricationReady
      ? []
      : result.blockers
          .map(compactStudentActionForFabricationDiagnostic)
          .filter((blocker): blocker is string => Boolean(blocker)),
  );

  if (!active.length) blockers.push('No active mechanism');
  if (mechanisms.every(result => result.fabricationReady)) {
    for (let firstIndex = 0; firstIndex < active.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < active.length; secondIndex += 1) {
        const collision = synchronizedMechanismCollisionOracle(
          active[firstIndex],
          active[secondIndex],
          project.settings.physicalKit,
        ).collision;
        if (collision) blockers.push('Move one mechanism. Mechanisms collide.');
      }
    }
  }

  return {
    status: blockers.length ? 'blocked' : 'project-ready',
    activeMechanismIds: active.map(mechanism => mechanism.id),
    mechanisms,
    blockers: unique(blockers),
  };
};
