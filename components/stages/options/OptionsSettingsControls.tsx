import type { ReactNode } from "react";

import { ContextHelp } from "../../ui/ContextHelp";
import type { ContextHelpId } from "../../../utils/contextHelp";

export const OPTIONS_SECTION_MANIFEST = [
  { id: "appearance", label: "Appearance", description: "Panels" },
  { id: "simulation", label: "Simulation", description: "Motion" },
  { id: "performance", label: "Performance", description: "Speed" },
  { id: "debugging", label: "Debugging", description: "Labels" },
  { id: "workflow", label: "Workflow", description: "Autosave" },
  { id: "fabrication", label: "Fabrication", description: "Board" },
  { id: "units", label: "Units", description: "Labels" },
] as const;

export type OptionsSectionMeta = (typeof OPTIONS_SECTION_MANIFEST)[number];

export const optionSection = (id: OptionsSectionMeta["id"]) =>
  OPTIONS_SECTION_MANIFEST.find((section) => section.id === id)!;

export const SettingsSection = ({
  section,
  children,
}: {
  section: OptionsSectionMeta;
  children: ReactNode;
}) => (
  <section
    id={section.id}
    className="settings-section space-y-3"
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

export const SelectField = ({
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
