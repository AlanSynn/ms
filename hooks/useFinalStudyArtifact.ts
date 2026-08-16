import { useEffect, useRef } from 'react';
import type { FabricationRecipe, ProjectState } from '../types';
import {
  buildFinalStudyArtifact,
  emitFinalStudyArtifact,
  fabricationSignatureForStudy,
} from '../infrastructure/study-final/artifact';

export const useFinalStudyArtifact = ({
  project,
  recipes,
  readiness,
  blueprintReached,
  packageGenerated,
}: {
  project: ProjectState;
  recipes: FabricationRecipe[];
  readiness: 'ready' | 'blocked';
  blueprintReached: boolean;
  packageGenerated: boolean;
}) => {
  const emitted = useRef(false);

  useEffect(() => {
    if (
      __MOTIONSMITH_STUDY_SUMMARY_ENABLED__ === false ||
      emitted.current ||
      !blueprintReached ||
      readiness !== 'ready'
    ) return;
    const artifact = buildFinalStudyArtifact({
      project,
      recipes,
      fabrication: {
        signature: fabricationSignatureForStudy(project, recipes),
        readiness,
      },
      blueprintReached,
      packageGenerated,
    });
    emitFinalStudyArtifact(artifact);
    emitted.current = true;
  }, [blueprintReached, packageGenerated, project, readiness, recipes]);
};

export const FinalStudyArtifactGate = (props: Parameters<typeof useFinalStudyArtifact>[0]) => {
  useFinalStudyArtifact(props);
  return null;
};
