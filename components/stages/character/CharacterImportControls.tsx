import type { RefObject } from "react";
import { BrainCircuit, FileJson, Sparkles, Upload } from "lucide-react";

import { ContextHelp } from "../../ui/ContextHelp";

export const CharacterImportControls = ({
  packageInputRef,
  onnxInputRef,
  importInputRef,
  onOpenGettingStarted,
  onPackage,
  onProcess,
  onImport,
  replaceCharacter,
  setReplaceCharacter,
}: {
  packageInputRef: RefObject<HTMLInputElement | null>;
  onnxInputRef: RefObject<HTMLInputElement | null>;
  importInputRef: RefObject<HTMLInputElement | null>;
  onOpenGettingStarted: () => void;
  onPackage: (files: File[]) => void;
  onProcess: (file: File) => void;
  onImport: (file: File) => void;
  replaceCharacter: boolean;
  setReplaceCharacter: (value: boolean) => void;
}) => (
  <div className="mt-4 grid gap-2" data-testid="character-import-controls">
    <button
      className="btn-primary"
      aria-label="Open Guide"
      onClick={onOpenGettingStarted}
    >
      <Sparkles size={16} /> Guide
    </button>
    <button
      type="button"
      className="btn-secondary cursor-pointer"
      aria-label="Load character file"
      onClick={() => packageInputRef.current?.click()}
    >
      <FileJson size={16} /> Load character file
    </button>
    <input
      ref={packageInputRef}
      data-testid="blank-package-input"
      hidden
      type="file"
      multiple
      accept=".json,.yaml,.yml,image/png,image/jpeg,image/webp,image/svg+xml"
      onChange={(e) => {
        const files = e.currentTarget.files
          ? (Array.from(e.currentTarget.files) as File[])
          : [];
        e.currentTarget.value = "";
        if (files.length) onPackage(files);
      }}
    />
    <div className="flex items-center gap-2">
      <button
        className="btn-secondary flex-1"
        onClick={() => onnxInputRef.current?.click()}
      >
        <BrainCircuit size={16} /> Create from image
      </button>
      <ContextHelp helpId="character.createFromImage" />
    </div>
    <input
      ref={onnxInputRef}
      data-testid="onnx-input"
      hidden
      type="file"
      accept="image/png,image/jpeg,image/webp"
      onChange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (file) onProcess(file);
      }}
    />
    <button
      type="button"
      className="btn-secondary cursor-pointer"
      onClick={() => importInputRef.current?.click()}
    >
      <Upload size={16} /> Open full project
    </button>
    <input
      ref={importInputRef}
      data-testid="onboarding-import-input"
      hidden
      type="file"
      accept="application/json,.json"
      onChange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (file) onImport(file);
      }}
    />
    <label className="replace-toggle">
      <input
        aria-label="Keep compatible mechanisms"
        type="checkbox"
        checked={replaceCharacter}
        onChange={(e) => setReplaceCharacter(e.target.checked)}
      />{" "}
      <span className="inline-flex items-center gap-1">
        Keep mechanisms
        <ContextHelp helpId="character.keepMechanisms" />
      </span>
    </label>
  </div>
);
