import type { RefObject } from "react";
import { FileJson, PackagePlus, Sparkles, Upload } from "lucide-react";

import { ContextHelp } from "../../ui/ContextHelp";

export const CharacterImportControls = ({
  packageInputRef,
  objectInputRef,
  importInputRef,
  onOpenGettingStarted,
  onAddSceneObject,
  sceneObjectDisabled,
  onPackage,
  onImport,
}: {
  packageInputRef: RefObject<HTMLInputElement | null>;
  objectInputRef: RefObject<HTMLInputElement | null>;
  importInputRef: RefObject<HTMLInputElement | null>;
  onOpenGettingStarted: () => void;
  onAddSceneObject: (file: File) => void;
  sceneObjectDisabled?: boolean;
  onPackage: (files: File[]) => void;
  onImport: (file: File) => void;
}) => (
  <div className="mt-4 grid gap-2" data-testid="character-import-controls">
    <button
      className="btn-primary"
      aria-label="Open Getting Started"
      onClick={onOpenGettingStarted}
    >
      <Sparkles size={16} /> Getting Started
    </button>
    <div className="grid gap-2" role="group" aria-label="Character files">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary flex-1 cursor-pointer"
          aria-label="Load character file"
          onClick={() => packageInputRef.current?.click()}
        >
          <FileJson size={16} /> Load character file
        </button>
        <ContextHelp helpId="character.loadCharacterFile" />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary flex-1 cursor-pointer"
          data-testid="character-add-scene-object"
          disabled={sceneObjectDisabled}
          onClick={() => objectInputRef.current?.click()}
        >
          <PackagePlus size={16} /> Add object
        </button>
        <ContextHelp helpId="character.loadObjectFile" />
      </div>
    </div>
    <input
      ref={objectInputRef}
      data-testid="scene-object-image-input"
      hidden
      type="file"
      disabled={sceneObjectDisabled}
      accept="image/png,image/jpeg,image/webp,image/svg+xml"
      onChange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = "";
        if (file) onAddSceneObject(file);
      }}
    />
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
  </div>
);
