export type HelpLocale = "en";

export type ContextHelpId =
  | "character.loadCharacterFile"
  | "character.loadObjectFile"
  | "character.drawPaint"
  | "character.drawObject"
  | "character.bodySides"
  | "path.draw"
  | "path.smoothness"
  | "path.trace"
  | "foundry.fitPath"
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
  "character.loadCharacterFile": {
    en: {
      title: "Character file",
      body: "Load a rigged character. It can replace the editable body parts.",
    },
  },
  "character.loadObjectFile": {
    en: {
      title: "Import object",
      body: "Import one picture as an editable scene object.",
    },
  },
  "character.drawPaint": {
    en: {
      title: "Draw & paint",
      body: "Paint the selected piece. Change shape edits its cut outline.",
    },
  },
  "character.drawObject": {
    en: {
      title: "Draw object",
      body: "Draw one flat piece, then choose Add object to keep it.",
    },
  },
  "character.bodySides": {
    en: {
      title: "Character left and right",
      body: "Left and right are named from the character's point of view.",
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
  "foundry.fitPath": {
    en: {
      title: "Fit path",
      body: "Snap the mechanism to the 15×15 board and match the drawn path with kit parts.",
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
      title: "Character outlines",
      body: "Clean character cut lines and holes. Use Build PDF to print artwork.",
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
      body: "See the next part, attachment, or object placement.",
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
