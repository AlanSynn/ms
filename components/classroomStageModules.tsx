import type { ComponentProps } from "react";

import type { AppStage } from "../types";

type AssemblyModule = typeof import("./stages/assembly/AssemblyGuide");
type BlueprintModule = typeof import("./stages/blueprint/BlueprintExport");
type CharacterModule = typeof import("./stages/character/CharacterSelection");
type FoundryModule = typeof import("./stages/foundry/MechanismFoundry");
type DesignModule = typeof import("./stages/mechanism/MechanismDesign");
type OptionsModule = typeof import("./stages/options/Options");
type PathModule = typeof import("./stages/path/PathEditor");

let assemblyPromise: Promise<AssemblyModule> | undefined;
let blueprintPromise: Promise<BlueprintModule> | undefined;
let characterPromise: Promise<CharacterModule> | undefined;
let foundryPromise: Promise<FoundryModule> | undefined;
let designPromise: Promise<DesignModule> | undefined;
let optionsPromise: Promise<OptionsModule> | undefined;
let pathPromise: Promise<PathModule> | undefined;
let assemblyModule: AssemblyModule | undefined;
let blueprintModule: BlueprintModule | undefined;
let characterModule: CharacterModule | undefined;
let foundryModule: FoundryModule | undefined;
let designModule: DesignModule | undefined;
let optionsModule: OptionsModule | undefined;
let pathModule: PathModule | undefined;

const loadAssembly = () => {
  assemblyPromise ??= import("./stages/assembly/AssemblyGuide")
    .then((module) => assemblyModule = module)
    .catch((error) => {
      assemblyPromise = undefined;
      throw error;
    });
  return assemblyPromise;
};
const loadBlueprint = () => {
  blueprintPromise ??= import("./stages/blueprint/BlueprintExport")
    .then((module) => blueprintModule = module)
    .catch((error) => {
      blueprintPromise = undefined;
      throw error;
    });
  return blueprintPromise;
};
export const loadCharacterStage = () => {
  characterPromise ??= import("./stages/character/CharacterSelection")
    .then((module) => characterModule = module)
    .catch((error) => {
      characterPromise = undefined;
      throw error;
    });
  return characterPromise;
};
const loadFoundry = () => {
  foundryPromise ??= import("./stages/foundry/MechanismFoundry")
    .then((module) => foundryModule = module)
    .catch((error) => {
      foundryPromise = undefined;
      throw error;
    });
  return foundryPromise;
};
const loadDesign = () => {
  designPromise ??= import("./stages/mechanism/MechanismDesign")
    .then((module) => designModule = module)
    .catch((error) => {
      designPromise = undefined;
      throw error;
    });
  return designPromise;
};
const loadOptions = () => {
  optionsPromise ??= import("./stages/options/Options")
    .then((module) => optionsModule = module)
    .catch((error) => {
      optionsPromise = undefined;
      throw error;
    });
  return optionsPromise;
};
const loadPath = () => {
  pathPromise ??= import("./stages/path/PathEditor")
    .then((module) => pathModule = module)
    .catch((error) => {
      pathPromise = undefined;
      throw error;
    });
  return pathPromise;
};

const AssemblyStage = (
  props: ComponentProps<AssemblyModule["AssemblyGuide"]>,
) => {
  if (!assemblyModule) throw loadAssembly();
  const Component = assemblyModule.AssemblyGuide;
  return <Component {...props} />;
};

const BlueprintStage = (
  props: ComponentProps<BlueprintModule["BlueprintExport"]>,
) => {
  if (!blueprintModule) throw loadBlueprint();
  const Component = blueprintModule.BlueprintExport;
  return <Component {...props} />;
};

const CharacterStage = (
  props: ComponentProps<CharacterModule["CharacterSelection"]>,
) => {
  if (!characterModule) throw loadCharacterStage();
  const Component = characterModule.CharacterSelection;
  return <Component {...props} />;
};

const FoundryStage = (
  props: ComponentProps<FoundryModule["MechanismFoundry"]>,
) => {
  if (!foundryModule) throw loadFoundry();
  const Component = foundryModule.MechanismFoundry;
  return <Component {...props} />;
};

const DesignStage = (
  props: ComponentProps<DesignModule["MechanismDesign"]>,
) => {
  if (!designModule) throw loadDesign();
  const Component = designModule.MechanismDesign;
  return <Component {...props} />;
};

const OptionsStage = (
  props: ComponentProps<OptionsModule["Options"]>,
) => {
  if (!optionsModule) throw loadOptions();
  const Component = optionsModule.Options;
  return <Component {...props} />;
};

const PathStage = (
  props: ComponentProps<PathModule["PathEditor"]>,
) => {
  if (!pathModule) throw loadPath();
  const Component = pathModule.PathEditor;
  return <Component {...props} />;
};

export const preloadNextClassroomStage = (stage: AppStage) => {
  switch (stage) {
    case "character":
      return Promise.all([loadPath(), loadFoundry()]);
    case "path":
      return loadFoundry();
    case "foundry":
      return loadDesign();
    case "design":
      return loadBlueprint();
    case "blueprint":
      return loadAssembly();
    case "assembly":
      return loadOptions();
    case "options":
      return loadCharacterStage();
  }
};

export const resolveAssemblyStage = () =>
  AssemblyStage;
export const resolveBlueprintStage = () =>
  BlueprintStage;
export const resolveCharacterStage = () =>
  CharacterStage;
export const resolveFoundryStage = () =>
  FoundryStage;
export const resolveDesignStage = () =>
  DesignStage;
export const resolveOptionsStage = () => OptionsStage;
export const resolvePathStage = () => PathStage;
