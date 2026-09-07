import { useMemo, useState } from "react";
import { DeferredThreePuppetPreview } from "../../DeferredThreePuppetPreview";
import type { CanvasViewport, ProjectState } from "../../../types";
import type { CharacterAssemblyStep } from "../../../utils/assemblyPlayback";
import type { AssemblySceneFrame } from "../../../utils/assemblySceneFrame";

/** Unpowered cut pieces use the existing physical scene without a made-up rig. */
export const AssemblyLocalPartsPreview = ({ project, step, sceneFrame, progress, playing }: {
  project: ProjectState;
  step: CharacterAssemblyStep;
  sceneFrame: AssemblySceneFrame;
  progress: number;
  playing: boolean;
}) => {
  const [viewport, setViewport] = useState<CanvasViewport>({ offset: { x: 0, y: 0 }, zoom: 1 });
  const fitRequest = useMemo(() => ({ id: 1, scope: "content" as const }), []);
  const assemblyPhase = step.phase === "cut-object" || step.phase === "place-object" ? undefined : step.phase;
  return <DeferredThreePuppetPreview
    project={project}
    skeleton={project.skeleton}
    paths={[]}
    viewport={viewport}
    setViewport={setViewport}
    fitRequest={fitRequest}
    inputMode="always"
    testId="assembly-local-parts"
    initialCameraPreset="iso"
    initialLayers={{ character: true, skeleton: false, mechanisms: false, grid: sceneFrame.boardMode !== "hidden" }}
    showLayerControls={false}
    showPathHandles={false}
    assemblyOverlay={assemblyPhase && (playing || progress > 0) ? {
      phase: assemblyPhase, progress, activePartIds: sceneFrame.activePartIds,
    } : undefined}
  />;
};
