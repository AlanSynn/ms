export type HelpLocale = "en";

export type ContextHelpId =
  | "character.createFromImage"
  | "character.keepMechanisms"
  | "path.draw"
  | "path.smoothness"
  | "path.trace"
  | "viewer.layers"
  | "blueprint.boardPreview"
  | "blueprint.customParts"
  | "blueprint.prefabKit"
  | "assembly.steps"
  | "options.devMode"
  | "options.fabricationExport"
  | "options.strictChecks";

export type ContextHelpEntry = {
  title: string;
  body: string;
};

export const DEFAULT_HELP_LOCALE: HelpLocale = "en";

export const CONTEXT_HELP: Record<
  ContextHelpId,
  Record<HelpLocale, ContextHelpEntry>
> = {
  "character.createFromImage": {
    en: {
      title: "Image",
      body: "Turn one picture into editable parts and joints on this device.",
    },
  },
  "character.keepMechanisms": {
    en: {
      title: "Keep mechanisms",
      body: "Keep buildable mechanisms when the new character still fits them.",
    },
  },
  "path.draw": {
    en: {
      title: "Draw",
      body: "Sketch the motion directly on the canvas. The selected part follows it.",
    },
  },
  "path.smoothness": {
    en: {
      title: "Smoothness",
      body: "Higher values soften wobbly hand-drawn points without moving the whole path.",
    },
  },
  "path.trace": {
    en: {
      title: "Trace",
      body: "Load a short motion clip and copy the tracked path onto the canvas.",
    },
  },
  "viewer.layers": {
    en: {
      title: "Viewer layers",
      body: "Show or hide grid, path, force, velocity, and trace overlays.",
    },
  },
  "blueprint.boardPreview": {
    en: {
      title: "Board preview",
      body: "Check where the build lands before downloading cut or kit files.",
    },
  },
  "blueprint.customParts": {
    en: {
      title: "Custom parts",
      body: "Download cut files for making your own parts from sheet material.",
    },
  },
  "blueprint.prefabKit": {
    en: {
      title: "Prefab kit",
      body: "Use the 15×15 board and ready-made parts, then follow Assembly.",
    },
  },
  "assembly.steps": {
    en: {
      title: "Steps",
      body: "Move one step at a time to see which part goes on the board next.",
    },
  },
  "options.devMode": {
    en: {
      title: "Dev mode",
      body: "Shows extra diagnostics for debugging. Keep it off in class.",
    },
  },
  "options.fabricationExport": {
    en: {
      title: "Export",
      body: "Choose custom cut files, prefab board files, or both.",
    },
  },
  "options.strictChecks": {
    en: {
      title: "Strict checks",
      body: "Block exports when spacing, holes, or moving stacks are not buildable.",
    },
  },
};

export const contextHelpFor = (
  helpId: ContextHelpId,
  locale: HelpLocale = DEFAULT_HELP_LOCALE,
): ContextHelpEntry => CONTEXT_HELP[helpId][locale] ?? CONTEXT_HELP[helpId].en;

export const contextHelpIds = Object.keys(CONTEXT_HELP) as ContextHelpId[];
