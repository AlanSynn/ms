import { useEffect, useState } from "react";

import { MiniNumber, Toggle } from "../../ui/InspectorControls";
import {
  EditorStageFrame,
  StageLeftSummary,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import type { AppStage, ProjectAction, ProjectState } from "../../../types";
import { physicalKitPreset } from "../../../utils/coordinates";
import {
  classroomAssessmentKeyHint,
  classroomAssessmentStatusText,
  resolveClassroomAssessmentBundle,
} from "../../../utils/classroomContent";
import { formatGridReadout } from "../../../utils/units";
import {
  OPTIONS_SECTION_MANIFEST,
  SelectField,
  SettingsSection,
  optionSection,
} from "./OptionsSettingsControls";

export const Options = ({
  project,
  dispatch,
  goStage,
}: {
  project: ProjectState;
  dispatch: (action: ProjectAction) => void;
  goStage: (stage: AppStage) => void;
}) => {
  const kit = project.settings.physicalKit;
  const updateSettings = (settings: Partial<ProjectState["settings"]>) =>
    dispatch({ type: "update_settings", settings });
  const updateKit = (
    physicalKit: Partial<ProjectState["settings"]["physicalKit"]>,
  ) => updateSettings({ physicalKit: { ...kit, ...physicalKit } });
  const [assessmentKeyInput, setAssessmentKeyInput] = useState(
    project.settings.classroomAssessmentKey,
  );
  useEffect(() => {
    setAssessmentKeyInput(project.settings.classroomAssessmentKey);
  }, [project.settings.classroomAssessmentKey]);
  const commitAssessmentKey = () =>
    updateSettings({ classroomAssessmentKey: assessmentKeyInput });
  const durationSeconds = Number(
    (project.settings.animationDurationMs / 1000).toFixed(1),
  );
  const unitSummary = formatGridReadout(kit, project.settings.gridUnit);
  const assessmentBundle = resolveClassroomAssessmentBundle(
    project.settings.classroomAssessmentKey,
  );
  return (
    <EditorStageFrame
      stage="options"
      className="options-stage-frame"
      layout={{
        workflow: workflowPane(
          <div className="stage-pane-stack">
            <StageLeftSummary
              project={project}
              title="Options"
              stage="options"
              goStage={goStage}
            >
              <h3>Settings</h3>
              <div className="stage-option-list">
                {OPTIONS_SECTION_MANIFEST.map((section) => (
                  <a
                    key={section.id}
                    className="workspace-side-link"
                    href={
                      section.id === "appearance"
                        ? "#options-settings-start"
                        : `#${section.id}`
                    }
                  >
                    {section.label}
                  </a>
                ))}
              </div>
            </StageLeftSummary>
          </div>,
        ),
        canvas: canvasPane(
          <div
            className="options-workspace workspace"
            data-testid="options-settings-workspace"
          >
            <header
              id="options-settings-start"
              className="options-settings-header"
            >
              <div className="section-title">Options</div>
              <h3>Settings</h3>
            </header>
            <div className="options-settings-grid">
              <SettingsSection section={optionSection("appearance")}>
                <SelectField
                  label="Theme"
                  value={project.settings.theme}
                  onChange={(theme) =>
                    updateSettings({
                      theme: theme as ProjectState["settings"]["theme"],
                    })
                  }
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="blueprint">Blueprint tint</option>
                </SelectField>
                <Toggle
                  label="Show toolbar"
                  checked={project.settings.toolbarVisible}
                  onChange={(toolbarVisible) =>
                    updateSettings({ toolbarVisible })
                  }
                />
                <Toggle
                  label="Part panel"
                  checked={project.settings.partPanelVisible}
                  onChange={(partPanelVisible) =>
                    updateSettings({ partPanelVisible })
                  }
                />
              </SettingsSection>
              <SettingsSection section={optionSection("simulation")}>
                <MiniNumber
                  label="Animation speed"
                  featureId="options.animationSpeed"
                  value={project.settings.animationSpeed}
                  min={0.1}
                  max={5}
                  step={0.1}
                  onChange={(animationSpeed) =>
                    updateSettings({ animationSpeed })
                  }
                />
                <MiniNumber
                  label="Duration"
                  value={durationSeconds}
                  min={0.1}
                  max={60}
                  step={0.1}
                  onChange={(seconds) =>
                    updateSettings({
                      animationDurationMs: Math.round(seconds * 1000),
                    })
                  }
                />
                <SelectField
                  label="Timing profile"
                  value={project.settings.timingProfile}
                  onChange={(timingProfile) =>
                    updateSettings({
                      timingProfile:
                        timingProfile as ProjectState["settings"]["timingProfile"],
                    })
                  }
                >
                  <option value="linear">Linear</option>
                  <option value="ease-in">Ease in</option>
                  <option value="ease-out">Ease out</option>
                  <option value="ease-in-out">Ease in/out</option>
                  <option value="realtime">Realtime</option>
                  <option value="slow">Slow</option>
                  <option value="presentation">Presentation</option>
                </SelectField>
                <MiniNumber
                  label="Friction"
                  value={project.settings.simulationFriction}
                  min={0}
                  max={2}
                  step={0.01}
                  onChange={(simulationFriction) =>
                    updateSettings({ simulationFriction })
                  }
                />
                <MiniNumber
                  label="Mass"
                  value={project.settings.simulationMassKg}
                  min={0.05}
                  max={10}
                  step={0.05}
                  onChange={(simulationMassKg) =>
                    updateSettings({ simulationMassKg })
                  }
                />
              </SettingsSection>
              <SettingsSection section={optionSection("performance")}>
                <SelectField
                  label="Performance preset"
                  value={project.settings.performancePreset}
                  onChange={(performancePreset) =>
                    updateSettings({
                      performancePreset:
                        performancePreset as ProjectState["settings"]["performancePreset"],
                    })
                  }
                >
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="high">High resolution</option>
                </SelectField>
                <SelectField
                  label="Snap quality"
                  value={project.settings.physicsSnapMode}
                  onChange={(physicsSnapMode) =>
                    updateSettings({
                      physicsSnapMode:
                        physicsSnapMode as ProjectState["settings"]["physicsSnapMode"],
                    })
                  }
                >
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="high">Strict</option>
                </SelectField>
              </SettingsSection>
              <SettingsSection section={optionSection("debugging")}>
                <Toggle
                  label="Dev mode"
                  helpId="options.devMode"
                  checked={project.settings.debugVisuals}
                  onChange={(debugVisuals) => updateSettings({ debugVisuals })}
                />
                <Toggle
                  label="Import details"
                  checked={project.settings.detailedProcessingSteps}
                  onChange={(detailedProcessingSteps) =>
                    updateSettings({ detailedProcessingSteps })
                  }
                />
              </SettingsSection>
              <SettingsSection section={optionSection("workflow")}>
                <Toggle
                  label="Enable autosave"
                  checked={project.settings.autosave}
                  onChange={(autosave) => updateSettings({ autosave })}
                />
                <MiniNumber
                  label="Autosave seconds"
                  value={project.settings.autosaveIntervalSeconds}
                  min={1}
                  max={600}
                  step={1}
                  disabled={!project.settings.autosave}
                  onChange={(autosaveIntervalSeconds) =>
                    updateSettings({ autosaveIntervalSeconds })
                  }
                />
                <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
                  Assessment key
                  <input
                    type="text"
                    className="field mt-1"
                    aria-label="Assessment key"
                    data-testid="options-assessment-key"
                    data-capture-mask
                    value={assessmentKeyInput}
                    onChange={(event) =>
                      setAssessmentKeyInput(event.currentTarget.value)
                    }
                    onBlur={commitAssessmentKey}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitAssessmentKey();
                    }}
                  />
                </label>
                <div
                  className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600"
                  data-testid="options-assessment-status"
                  data-requested-assessment-key={assessmentBundle.requestedKey}
                  data-active-assessment-key={assessmentBundle.activeKey}
                >
                  <div className="font-bold text-slate-800">
                    {assessmentBundle.bundle.label}
                  </div>
                  <div>{classroomAssessmentStatusText(assessmentBundle)}</div>
                  <div>{classroomAssessmentKeyHint()}</div>
                </div>
              </SettingsSection>
              <SettingsSection section={optionSection("fabrication")}>
                <SelectField
                  label="Export"
                  helpId="options.fabricationExport"
                  value={kit.exportMode}
                  onChange={(exportMode) =>
                    updateKit({
                      exportMode:
                        exportMode as ProjectState["settings"]["physicalKit"]["exportMode"],
                    })
                  }
                >
                  <option value="both">Both</option>
                  <option value="custom-parts">
                    Custom only · SVG/PDF/STL
                  </option>
                  <option value="prefab-board">Prefab</option>
                </SelectField>
                <SelectField
                  label="Format"
                  value={kit.defaultExportFormat}
                  onChange={(defaultExportFormat) =>
                    updateKit({
                      defaultExportFormat:
                        defaultExportFormat as ProjectState["settings"]["physicalKit"]["defaultExportFormat"],
                    })
                  }
                >
                  <option value="both">SVG + JSON</option>
                  <option value="svg">SVG</option>
                  <option value="json">JSON</option>
                </SelectField>
                <SelectField
                  label="Download file"
                  value={kit.cutSheetFileType}
                  onChange={(cutSheetFileType) =>
                    updateKit({
                      cutSheetFileType:
                        cutSheetFileType as ProjectState["settings"]["physicalKit"]["cutSheetFileType"],
                    })
                  }
                >
                  <option value="pdf">PDF default</option>
                  <option value="svg">SVG</option>
                </SelectField>
                <Toggle
                  label="Strict checks"
                  helpId="options.strictChecks"
                  checked={project.settings.fabricationReadyMode}
                  onChange={(fabricationReadyMode) =>
                    updateSettings({ fabricationReadyMode })
                  }
                />
                <SelectField
                  label="Board"
                  value={kit.profileKey}
                  onChange={(profileKey) =>
                    updateSettings({
                      physicalKit: physicalKitPreset(profileKey, kit),
                    })
                  }
                >
                  <option value="letter-15x15-2cm">
                    Letter · 15×15 · 20mm
                  </option>
                  <option value="letter-12x12-2cm">
                    Letter · 12×12 · 20mm
                  </option>
                  <option value="custom">Custom profile</option>
                </SelectField>
                <MiniNumber
                  label="Grid pitch mm"
                  value={kit.gridPitchMm}
                  min={5}
                  max={50}
                  step={1}
                  onChange={(gridPitchMm) =>
                    updateKit({
                      gridPitchMm,
                      profileKey:
                        kit.profileKey === "custom" ? "custom" : kit.profileKey,
                    })
                  }
                />
                <div
                  className="rounded-2xl bg-slate-100 p-3 text-sm text-slate-600"
                  data-testid="grid-cell-readout"
                >
                  <div className="font-bold text-slate-800">Grid</div>
                  <div>{unitSummary}</div>
                  <div>
                    {kit.boardCells}×{kit.boardCells} board grid ·{" "}
                    {kit.sheetWidthMm.toFixed(1)}×{kit.sheetHeightMm.toFixed(1)}
                    mm sheet
                  </div>
                </div>
              </SettingsSection>
              <SettingsSection section={optionSection("units")}>
                <SelectField
                  label="Grid units"
                  value={project.settings.gridUnit}
                  onChange={(gridUnit) =>
                    updateSettings({
                      gridUnit:
                        gridUnit as ProjectState["settings"]["gridUnit"],
                    })
                  }
                >
                  <option value="cm">Centimeters</option>
                  <option value="inch">Inches</option>
                  <option value="px">Scene pixels</option>
                </SelectField>
              </SettingsSection>
            </div>
          </div>,
        ),
        inspector: inspectorPane(null),
      }}
    />
  );
};
