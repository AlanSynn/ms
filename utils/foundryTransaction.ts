import type {
  FoundryExportPackage,
  MechanismCandidateTransactionResult,
  MechanismCommitIntent,
  MechanismConfig,
  MechanismRecoveryCandidates,
  ProjectState,
} from '../types';
import { resolveMechanismEditAttempt } from './mechanismEditAuthority';
import { mechanismWithGeneratedPath } from './mechanismGeneratedPath';
import { projectMechanismReadiness } from './mechanismReadiness';
import { mechanismSnapshotFingerprint } from './mechanismSnapshot';
import { isSoftReadinessBlocker } from './fabricationReadiness';

const withoutPackage = (mechanism: MechanismConfig): MechanismConfig => {
  const { foundryExport: _foundryExport, ...clean } = mechanism;
  return clean;
};

export const foundryMechanismFingerprint = (mechanism: MechanismConfig) =>
  mechanismSnapshotFingerprint(withoutPackage(mechanism));

const candidateProject = (project: ProjectState, mechanism: MechanismConfig): ProjectState => ({
  ...project,
  mechanisms: project.mechanisms.some(item => item.id === mechanism.id)
    ? project.mechanisms.map(item => item.id === mechanism.id ? mechanism : item)
    : [...project.mechanisms, mechanism],
});

const blockedResult = (
  intent: MechanismCommitIntent,
  previous: MechanismConfig,
  previousExists: boolean,
  blocker: string,
  recoveryCandidates?: MechanismRecoveryCandidates,
): MechanismCandidateTransactionResult => ({
  intent,
  status: 'blocked',
  mechanism: previous,
  previousExists,
  blocker,
  recoveryCandidates,
});

export const resolveFoundryTransaction = ({
  project,
  candidate,
  intent,
  generatePackage,
  allowSoftReadinessBlockers,
}: {
  project: ProjectState;
  candidate: MechanismConfig;
  intent: MechanismCommitIntent;
  generatePackage?: (accepted: MechanismConfig) => FoundryExportPackage;
  allowSoftReadinessBlockers?: boolean;
}): MechanismCandidateTransactionResult => {
  const previous = project.mechanisms.find(item => item.id === candidate.id);
  if (
    intent === 'simulation-only' &&
    previous &&
    foundryMechanismFingerprint(previous) === foundryMechanismFingerprint(candidate)
  ) {
    return {
      intent,
      status: 'committed',
      mechanism: previous,
      previousExists: true,
      fingerprint: foundryMechanismFingerprint(previous),
    };
  }
  const accepted = resolveMechanismEditAttempt(
    project,
    previous,
    withoutPackage(candidate),
  );
  if (accepted.status !== 'accepted') {
    return blockedResult(
      intent,
      previous ?? candidate,
      Boolean(previous),
      accepted.blocker,
      accepted.recoveryCandidates,
    );
  }

  const mechanism = withoutPackage(mechanismWithGeneratedPath(
    accepted.mechanism,
    { kit: project.settings.physicalKit },
  ));
  const readiness = projectMechanismReadiness(candidateProject(project, mechanism));
  const mechanismReadiness = readiness.mechanisms.find(
    (result) => result.mechanismId === mechanism.id,
  );
  const blocker = readiness.blockers[0];
  if (intent === 'simulation-only') {
    if (
      previous &&
      foundryMechanismFingerprint(previous) === foundryMechanismFingerprint(mechanism)
    ) {
      return {
        intent,
        status: 'committed',
        mechanism: previous,
        previousExists: true,
        fingerprint: foundryMechanismFingerprint(previous),
        blocker,
      };
    }
    return {
      intent,
      status: 'committed',
      mechanism,
      previousExists: Boolean(previous),
      fingerprint: foundryMechanismFingerprint(mechanism),
      blocker,
    };
  }
  const canCommit = readiness.status === 'project-ready'
    || (allowSoftReadinessBlockers === true
      && readiness.blockers.length > 0
      && readiness.blockers.every((item) => isSoftReadinessBlocker(item)));
  if (!canCommit) {
    return blockedResult(
      intent,
      previous ?? mechanism,
      Boolean(previous),
      blocker ?? 'Project not ready',
      mechanismReadiness?.recoveryCandidates,
    );
  }

  const fingerprint = foundryMechanismFingerprint(mechanism);
  if (!generatePackage) {
    return { intent, status: 'ready', mechanism, previousExists: Boolean(previous), fingerprint };
  }

  let foundryExport: FoundryExportPackage;
  try {
    foundryExport = generatePackage(mechanism);
  } catch {
    return blockedResult(intent, previous ?? candidate, Boolean(previous), 'Package generation failed');
  }
  if (
    foundryExport.mechanismId !== mechanism.id ||
    foundryExport.mechanismType !== mechanism.type ||
    foundryMechanismFingerprint(foundryExport.parameters as MechanismConfig) !== fingerprint
  ) {
    return blockedResult(intent, previous ?? candidate, Boolean(previous), 'Package validation failed');
  }
  return {
    intent,
    status: 'committed',
    mechanism: { ...mechanism, foundryExport },
    previousExists: Boolean(previous),
    fingerprint,
    foundryExport,
  };
};
