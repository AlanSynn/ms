import {
  createDefaultMechanism,
  createSampleProject,
} from '../../utils/project';
import {
  generateMechanismPointTraces,
} from '../../utils/kinematics';
import { fitMechanismToTargetPath } from '../../utils/mechanismRecommendations';
import type { ProjectState } from '../../types';

/**
 * A deterministic accepted four-bar fixture for export/renderer contracts.
 * Keep this independent from the certified classroom baseline so export tests
 * retain a small, purpose-built mechanism and path fixture.
 */
export const createFabricationReadyFourBarProject = (): ProjectState => {
  const project = createSampleProject();
  const seed = {
    ...createDefaultMechanism('4bar', 'fabrication-fit-fixture'),
    anchorX: 0,
    anchorY: 0,
    groundLength: 160,
    crankLength: 80,
    couplerLength: 160,
    rockerLength: 80,
    groundAngle: 0,
    assemblyMode: 'open' as const,
    targetPartId: 'right_arm_lower',
    targetPathId: 'fabrication-fit-path',
    targetAnchorJointId: 'right_hand',
  };
  const trace = generateMechanismPointTraces(seed, 96).traces.find(
    (candidate) => candidate.id === 'C',
  );
  if (!trace || trace.points.length < 90) {
    throw new Error('Fabrication fixture could not produce a complete C trace.');
  }
  const path = {
    ...project.paths['path-right-arm'],
    id: 'fabrication-fit-path',
    points: trace.points,
    closed: true,
  };
  const withPath: ProjectState = {
    ...project,
    // Keep the fixture's canonical fitted path as the only path. The sample
    // project's waving path is intentionally replaced so downstream browser
    // coverage cannot accidentally count an unrelated authored path.
    paths: { [path.id]: path },
  };
  const fitted = fitMechanismToTargetPath(withPath, seed, path.id);
  if (fitted.fabricationMetadata?.pathFit?.status !== 'fit') {
    throw new Error('Fabrication fixture unexpectedly failed its physical fit.');
  }
  return {
    ...withPath,
    mechanisms: [fitted],
    selectedPathId: path.id,
    selectedMechanismId: fitted.id,
  };
};
