import type { ReactNode } from "react";

import { MiniNumber, Toggle } from "../../ui/InspectorControls";
import { ContextHelp } from "../../ui/ContextHelp";
import {
  EditorStageFrame,
  StageLeftSummary,
  canvasPane,
  inspectorPane,
  workflowPane,
} from "../stageLayout";
import type { AppStage, ProjectAction, ProjectState } from "../../../types";
import type { ContextHelpId } from "../../../utils/contextHelp";
import { physicalKitPreset } from "../../../utils/coordinates";
import { formatGridLabel, formatGridReadout } from "../../../utils/units";

const OPTIONS_SECTION_MANIFEST = [
  { id: "appearance", label: "Appearance", description: "Panels" },
  { id: "simulation", label: "Simulation", description: "Motion" },
  { id: "performance", label: "Performance", description: "Speed" },
  { id: "debugging", label: "Debugging", description: "Labels" },
  { id: "workflow", label: "Workflow", description: "Autosave" },
  { id: "fabrication", label: "Fabrication", description: "Board" },
  { id: "units", label: "Units", description: "Labels" },
] as const;

type OptionsSectionMeta = (typeof OPTIONS_SECTION_MANIFEST)[number];
const optionSection = (id: OptionsSectionMeta["id"]) =>
  OPTIONS_SECTION_MANIFEST.find((section) => section.id === id)!;
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
  const durationSeconds = Number(
    (project.settings.animationDurationMs / 1000).toFixed(1),
  );
  const unitSummary = formatGridReadout(kit, project.settings.gridUnit);
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
                    href={`#${section.id}`}
                  >
                    {section.label}
                  </a>
                ))}
              </div>
            </StageLeftSummary>
          </div>,
        ),
        canvas: canvasPane(
          <div className="path-canvas-shell options-preview-shell workspace overflow-hidden p-6">
            <svg
              viewBox="0 0 640 420"
              className="options-preview-canvas w-full h-full"
              role="img"
              aria-label="Options preview canvas"
            >
              <defs>
                <pattern
                  id="options-grid"
                  width="40"
                  height="40"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M40 0H0V40"
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>
              <rect
                x="34"
                y="24"
                width="572"
                height="372"
                rx="24"
                fill="white"
                stroke="#d6dbe8"
              />
              <rect
                x="34"
                y="24"
                width="572"
                height="372"
                rx="24"
                fill="url(#options-grid)"
                opacity=".9"
              />
              <text x="58" y="64" fill="#94a3b8" fontSize="18" fontWeight="800">
                {formatGridLabel(
                  project.settings.physicalKit,
                  project.settings.gridUnit,
                )}
              </text>
              <g transform="translate(300 210)">
                <rect
                  x="-70"
                  y="-90"
                  width="140"
                  height="180"
                  rx="32"
                  fill="#cbd5e1"
                  opacity=".55"
                />
                <circle cx="0" cy="-115" r="38" fill="#d8dee8" />
                <path
                  d="M 70 -52 C 142 -24 122 58 78 94"
                  fill="none"
                  stroke="#8b5cf6"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                <path
                  d="M -70 -54 C -126 -18 -116 60 -68 94"
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="6"
                  strokeLinecap="round"
                  opacity=".7"
                />
              </g>
              <text
                x="58"
                y="362"
                fill="#64748b"
                fontSize="14"
                fontWeight="800"
              >
                {project.settings.theme} theme ·{" "}
                {project.settings.animationSpeed.toFixed(1)}x speed ·{" "}
                {project.settings.physicalKit.defaultExportFormat} export
              </text>
            </svg>
          </div>,
        ),
        inspector: inspectorPane(
          <div className="options-workspace stage-pane-stack">
            <section className="workspace space-y-5 p-6">
              <div>
                <div className="section-title">Options</div>
                <h3>Settings</h3>
              </div>
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
                  label="Friction μ"
                  value={project.settings.simulationFriction}
                  min={0}
                  max={2}
                  step={0.01}
                  onChange={(simulationFriction) =>
                    updateSettings({ simulationFriction })
                  }
                />
                <MiniNumber
                  label="Mass kg"
                  value={project.settings.simulationMassKg}
                  min={0.05}
                  max={10}
                  step={0.05}
                  onChange={(simulationMassKg) =>
                    updateSettings({ simulationMassKg })
                  }
                />
              </SettingsSection>
            </section>
            <section className="space-y-5">
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
                  <option value="high">High</option>
                </SelectField>
                <SelectField
                  label="Physics snap mode"
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
                    {kit.boardCells}×{kit.boardCells} board holes ·{" "}
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
            </section>
          </div>,
        ),
      }}
    />
  );
};

const SettingsSection = ({
  section,
  children,
}: {
  section: OptionsSectionMeta;
  children: ReactNode;
}) => (
  <section
    id={section.id}
    className="workspace settings-section space-y-3 p-5"
    data-testid={`options-${section.id}`}
    aria-label={section.label}
  >
    <div>
      <div className="section-title" title={section.description}>
        {section.label}
      </div>
    </div>
    <div className="space-y-3">{children}</div>
  </section>
);

const SelectField = ({
  label,
  helpId,
  value,
  onChange,
  children,
}: {
  label: string;
  helpId?: ContextHelpId;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) => (
  <label className="block text-xs font-black uppercase tracking-wider text-slate-500">
    <span className="inline-flex items-center gap-1">
      {label}
      {helpId && <ContextHelp helpId={helpId} />}
    </span>
    <select
      aria-label={label}
      className="field mt-1"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  </label>
);
