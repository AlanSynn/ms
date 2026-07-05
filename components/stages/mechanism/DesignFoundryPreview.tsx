import { useMemo, useState } from "react";
import { ThreePuppetPreview } from "../../ThreePuppetPreview";
import type { CanvasViewport, MechanismConfig, ProjectAction, ProjectMotionPath, ProjectState } from "../../../types";
import { buildDesignAutomataProjection } from "../../../utils/designAutomataProjection";

type DesignFoundryPreviewProps = {
  project: ProjectState;
  mechanism?: MechanismConfig;
  angle: number;
  showTrace: boolean;
  dispatch: (action: ProjectAction) => void;
};

export const DesignFoundryPreview = ({
  project,
  mechanism,
  angle,
  showTrace,
  dispatch,
}: DesignFoundryPreviewProps) => {
  const [showGrid, setShowGrid] = useState(true);
  const [showUserPathPreview, setShowUserPathPreview] = useState(true);
  const [showMechanismPathPreview, setShowMechanismPathPreview] = useState(true);
  const [viewport, setViewport] = useState<CanvasViewport>({
    offset: { x: 0, y: 0 },
    zoom: 1,
  });

  const projection = useMemo(
    () => buildDesignAutomataProjection(project, mechanism, angle),
    [angle, mechanism, project],
  );
  const showUserPath = showTrace && showUserPathPreview;
  const showMechanismPath = showTrace && showMechanismPathPreview;

  const paths = useMemo(() => {
    const visiblePaths: ProjectMotionPath[] = [];
    if (showUserPath && projection.userPath) visiblePaths.push(projection.userPath);
    if (showMechanismPath && projection.mechanismPath) visiblePaths.push(projection.mechanismPath);
    return visiblePaths;
  }, [projection.mechanismPath, projection.userPath, showMechanismPath, showUserPath]);
  const selectedVisiblePathId =
    showMechanismPath && projection.mechanismPath
      ? projection.mechanismPath.id
      : showUserPath && projection.userPath
        ? projection.userPath.id
        : undefined;

  if (!projection.mechanism) {
    return (
      <div
        className="blueprint-empty-state"
        data-testid="design-shared-foundry-empty"
      >
        Add a mechanism.
      </div>
    );
  }

  const targetError = projection.targetError;
  const target = projection.target;

  return (
    <section
      className="design-automata-preview canvas-workspace"
      data-testid="design-shared-foundry-preview"
      data-renderer-source="ThreePuppetPreview"
      data-shared-with="foundry-registry"
      data-design-scene-mode="automata-integrated"
      data-mechanism-id={projection.mechanism.id}
      data-mechanism-type={projection.mechanism.type}
      data-foundry-feature-label={projection.featureLabel ?? ""}
      data-foundry-feature-issue-count={projection.featureIssues.length}
      data-guided-context-mode="integrated-automata"
      data-guided-context-part-count={project.partOrder.length}
      data-guided-context-path-count={projection.userPath ? 1 : 0}
      data-guided-context-path-id={projection.userPath?.id ?? ""}
      data-user-path-preview={showUserPath ? "shown" : "hidden"}
      data-mechanism-path-preview={showMechanismPath ? "shown" : "hidden"}
      data-design-motion-source={projection.motionSource}
      data-design-generated-path-count={projection.mechanism.generatedPath?.length ?? 0}
      data-design-visible-mechanism-count={projection.mechanisms.length}
      data-design-target-joint-id={projection.targetJointId ?? ""}
      data-design-target-error={targetError === undefined ? "missing" : targetError.toFixed(3)}
      data-design-target-x={target ? target.x.toFixed(2) : "missing"}
      data-design-target-y={target ? target.y.toFixed(2) : "missing"}
      data-design-animated-part-count={Object.keys(projection.animatedParts).length}
      data-design-animated-object-count={Object.keys(projection.animatedSceneObjects).length}
      data-design-show-trace={showTrace ? "true" : "false"}
      data-design-trace-layer={showTrace ? "shown" : "hidden"}
    >
      <div
        className="foundry-camera-hud design-foundry-camera-hud"
        data-testid="design-foundry-camera-controls"
        aria-label="Automata viewer controls"
      >
        <span className="foundry-camera-readout" data-testid="design-foundry-camera-readout">
          Automata view
        </span>
        <button
          type="button"
          className={showGrid ? "active" : ""}
          aria-pressed={showGrid}
          onClick={() => setShowGrid((value) => !value)}
        >
          Grid
        </button>
        <button
          type="button"
          data-testid="design-toggle-user-path"
          className={showUserPath ? "active" : ""}
          aria-pressed={showUserPath}
          disabled={!showTrace}
          onClick={() => setShowUserPathPreview((value) => !value)}
        >
          User path
        </button>
        <button
          type="button"
          data-testid="design-toggle-mechanism-path"
          className={showMechanismPath ? "active" : ""}
          aria-pressed={showMechanismPath}
          disabled={!showTrace}
          onClick={() => setShowMechanismPathPreview((value) => !value)}
        >
          Mech path
        </button>
      </div>
      <ThreePuppetPreview
        project={project}
        animatedParts={projection.animatedParts}
        animatedSceneObjects={projection.animatedSceneObjects}
        skeleton={projection.skeleton}
        mechanisms={projection.mechanisms}
        paths={paths}
        selectedPathId={selectedVisiblePathId}
        angle={angle}
        viewport={viewport}
        setViewport={setViewport}
        inputMode="always"
        testId="design-automata-scene"
        cameraPresets={["front", "iso", "top"]}
        showToolbar
        onSelectPart={(partId) => dispatch({ type: "select_part", partId })}
        onSelectSceneObject={(objectId) => dispatch({ type: "select_scene_object", objectId })}
        onSelectMechanism={(mechanismId) =>
          dispatch({
            type: "set_mechanisms",
            mechanisms: project.mechanisms,
            selectedMechanismId: mechanismId,
          })
        }
        initialLayers={{
          grid: showGrid,
          character: true,
          skeleton: true,
          mechanisms: true,
        }}
      />
    </section>
  );
};
