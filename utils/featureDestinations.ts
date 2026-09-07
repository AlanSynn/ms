import type { AppStage, ProjectState } from '../types';
import { STAGES } from '../components/shell/workflowStages';
import { APP_COMMANDS, APP_MENU_GROUPS, commandById, type AppCommandId, type AppMenuId } from './appCommands';
import { contextHelpFor, type ContextHelpId } from './contextHelp';
import { handoffGate } from './project';

export type LocalFeatureId =
  | 'character.gettingStarted' | 'character.loadCharacterFile' | 'character.loadObjectFile'
  | 'character.drawPaint' | 'character.drawObject'
  | 'path.draw' | 'path.target' | 'path.addMotion' | 'path.switchMotion' | 'path.trace' | 'path.smoothness'
  | 'foundry.fitPath' | 'foundry.templates' | 'foundry.attach' | 'foundry.use'
  | 'design.mechanism' | 'blueprint.pdf' | 'blueprint.customParts' | 'assembly.steps'
  | 'playback.play' | 'playback.scrub' | 'options.animationSpeed';
export type FeatureId = AppCommandId | LocalFeatureId;
export type SupportFeatureSurface = 'feedback' | 'whatsNew';

export type FeatureDestination = {
  id: FeatureId;
  label: string;
  description: string;
  aliases: readonly string[];
  helpId?: ContextHelpId;
  commandId?: AppCommandId;
  targetId: FeatureId;
  stage?: AppStage | 'playback';
  menu?: AppMenuId;
  surface?: SupportFeatureSurface;
  unavailable?: string;
};

const commandAliases: Partial<Record<AppCommandId, readonly string[]>> = {
  'project.save': ['save my work', 'keep for tomorrow', 'keep this for next class', 'download project', 'download file', 'snapshot', 'portable copy', 'save a copy'],
  'project.open': ['reopen', 'load my project', 'load file', 'continue my work', 'continue yesterday work', 'open saved file'],
  'project.recoverAutosave': ['lost my work', 'recover autosave', 'restore browser save', 'get work back'],
  'project.new': ['start again', 'blank project', 'new work'],
  'project.resetLesson': ['reset starter', 'restore lesson', 'reset lesson'],
  'edit.undo': ['go back', 'fix my last change', 'reverse my last change', 'undo mistake', 'take back change'],
  'edit.redo': ['put change back', 'redo change'],
  'view.fit': ['fit view', 'see everything', 'center canvas', 'whole drawing', 'zoom to fit'],
  'view.zoomIn': ['closer view', 'make view bigger', 'zoom closer'],
  'view.zoomOut': ['farther view', 'make view smaller', 'zoom away'],
  'stage.project': ['project files'],
  'stage.character': ['body parts', 'edit character'],
  'stage.path': ['path editor'],
  'stage.foundry': ['mechanism library'],
  'stage.design': ['mechanism design', 'change mechanism parameters'],
  'stage.blueprint': ['build files'],
  'stage.assembly': ['assembly guide'],
  'options.preferences': ['settings', 'preferences'],
  'help.shortcuts': ['keyboard help', 'keyboard commands'],
  'help.feedback': ['report a bug', 'something is broken', 'something broke', 'suggest a feature', 'suggest an improvement', 'send an idea', 'tell you a problem', 'report a problem'],
  'help.whatsNew': ['updates', 'what is new', 'whats new', 'what changed', 'new things', 'release notes'],
};

const stageControlTargets: Partial<Record<AppStage, LocalFeatureId>> = {
  character: 'character.loadCharacterFile', path: 'path.draw', foundry: 'foundry.templates',
  design: 'design.mechanism', blueprint: 'blueprint.pdf', assembly: 'assembly.steps',
};

const commandDestinations: FeatureDestination[] = APP_COMMANDS
  .filter(command => command.menuVisible !== false && command.id !== 'help.findFeature')
  .map(command => {
    const stageTarget = command.stageTarget && stageControlTargets[command.stageTarget];
    const surface = command.id === 'help.feedback' ? 'feedback' : command.id === 'help.whatsNew' ? 'whatsNew' : undefined;
    return {
      id: command.id,
      commandId: command.id,
      label: command.label,
      description: command.description,
      aliases: commandAliases[command.id] ?? [],
      targetId: stageTarget ?? command.id,
      ...(stageTarget ? { stage: command.stageTarget } : { menu: command.menu }),
      ...(surface ? { surface } : {}),
    };
  });

type LocalDestination = Omit<FeatureDestination, 'id' | 'targetId' | 'description'> & {
  id: LocalFeatureId;
  description?: string;
};
const localDefinitions: LocalDestination[] = [
  { id: 'character.gettingStarted', label: 'Getting Started', stage: 'character', aliases: ['choose a starter', 'guided project', 'starter rig', 'guide', 'start with example'] },
  { id: 'character.loadCharacterFile', label: 'Load character file', helpId: 'character.loadCharacterFile', stage: 'character', aliases: ['import body', 'rigged character', 'character package', 'replace character'] },
  { id: 'character.loadObjectFile', label: 'Import object', helpId: 'character.loadObjectFile', stage: 'character', aliases: ['import object', 'import a picture', 'object image', 'load a prop image'] },
  { id: 'character.drawPaint', label: 'Draw & paint', helpId: 'character.drawPaint', stage: 'character', unavailable: 'Choose a part or object to paint.', aliases: ['paint', 'paint a face', 'paint eyes', 'paint clothes', 'paint details', 'brush', 'pencil', 'erase paint', 'erase the middle', 'paint a line', 'filled rectangle', 'filled ellipse', 'base color', 'change shape', 'edit cut outline'] },
  { id: 'character.drawObject', label: 'Draw object', helpId: 'character.drawObject', stage: 'character', aliases: ['draw a prop', 'make a prop', 'add a prop', 'draw a star', 'draw my own object', 'draw a sign', 'single piece figure'] },
  { id: 'path.draw', label: 'Draw path', helpId: 'path.draw', stage: 'path', aliases: ['draw', 'motion', 'pathway', 'move an arm', 'make the hand move', 'sketch movement', 'draw a curve', 'change movement', 'draw a line', 'make character wave'] },
  { id: 'path.target', label: 'Motion target', description: 'Choose the body part or object to move.', stage: 'path', aliases: ['another arm', 'other arm', 'different body part', 'move a leg', 'choose part', 'switch body part'] },
  { id: 'path.addMotion', label: 'Add path', description: 'Choose a target for another path.', stage: 'path', aliases: ['second path', 'another path', 'two paths', 'both arms', 'second motion', 'new motion', 'extra movement', 'more paths'] },
  { id: 'path.switchMotion', label: 'Motions', description: 'Select an existing motion path.', stage: 'path', aliases: ['switch path', 'switch motion', 'existing motions', 'switch the line I made', 'choose existing path', 'edit other path'] },
  { id: 'path.trace', label: 'Trace', helpId: 'path.trace', stage: 'path', aliases: ['trace video', 'copy motion clip', 'track gif', 'video movement'] },
  { id: 'path.smoothness', label: 'Smoothness', helpId: 'path.smoothness', stage: 'path', unavailable: 'Select a motion first.', aliases: ['smooth line', 'less wobbly', 'smooth curve', 'soften path'] },
  { id: 'foundry.fitPath', label: 'Fit motion', helpId: 'foundry.fitPath', stage: 'foundry', aliases: ['fit', 'fit path', 'match my path', 'match this curve', 'fit my motion', 'make mechanism follow line'] },
  { id: 'foundry.templates', label: 'Mechanism templates', description: 'Choose a mechanism to try.', stage: 'foundry', aliases: ['choose a mechanism', 'mechanism choices', 'choose a machine', 'different mechanism', 'gear or linkage', 'machine types'] },
  { id: 'foundry.attach', label: 'Attach to part', stage: 'foundry', aliases: ['connect mechanism', 'attach machine', 'attach to body', 'move attachment'] },
  { id: 'foundry.use', label: 'Use this mechanism', stage: 'foundry', aliases: ['use fitted mechanism', 'keep mechanism', 'assign mechanism', 'finish fit'] },
  { id: 'design.mechanism', label: 'Mechanism instance', description: 'Select a mechanism to adjust.', stage: 'design', aliases: ['edit mechanism', 'choose existing mechanism', 'change machine settings'] },
  { id: 'blueprint.pdf', label: 'Download Build PDF', description: 'Print painted pieces, mechanism drawings, and build steps.', stage: 'blueprint', aliases: ['print', 'pdf', 'print my painting', 'print my prop', 'print my character', 'cut out mechanism', 'print mechanism', 'download build files', 'paper mechanism', 'blueprint pdf'] },
  { id: 'blueprint.customParts', label: 'Character outlines PDF', helpId: 'blueprint.customParts', stage: 'blueprint', aliases: ['body template', 'cut out', 'paper body pieces', 'cut out my person', 'character pdf', 'print body parts', 'character sheet', 'clean outlines'] },
  { id: 'assembly.steps', label: 'Assembly steps', helpId: 'assembly.steps', stage: 'assembly', unavailable: 'Add a character, cuttable object, or mechanism first.', aliases: ['assemble', 'build steps', 'put it together', 'put the parts together', 'build instructions', 'how to build', 'assemble parts', 'place my prop'] },
  { id: 'playback.play', label: 'Play / Pause', description: 'Watch the current motion.', stage: 'playback', aliases: ['play', 'pause', 'watch it move', 'stop animation', 'run motion', 'preview movement'] },
  { id: 'playback.scrub', label: 'Playback scrubber', description: 'Move through the motion or build steps.', stage: 'playback', aliases: ['scrub', 'timeline', 'skip ahead', 'animation position'] },
  { id: 'options.animationSpeed', label: 'Animation speed', description: 'Change playback speed.', stage: 'options', aliases: ['speed', 'make it slower', 'slow down', 'make it faster', 'speed up', 'animation speed'] },
];

export const FEATURE_DESTINATIONS: readonly FeatureDestination[] = [
  ...commandDestinations,
  ...localDefinitions.map(definition => ({
    ...definition,
    targetId: definition.id,
    description: definition.description ?? (definition.helpId ? contextHelpFor(definition.helpId).body : ''),
  })),
];

export const featureDestinationById = (id: FeatureId) => FEATURE_DESTINATIONS.find(feature => feature.id === id);

export const resolveFeatureDestination = (feature: FeatureDestination, currentStage: AppStage) => {
  const stage = feature.stage === 'playback'
    ? (['path', 'design', 'assembly', 'foundry'].includes(currentStage) ? currentStage : 'path')
    : feature.stage;
  const stageLabel = STAGES.find(item => item.id === stage)?.label ?? stage;
  const menuLabel = APP_MENU_GROUPS.find(group => group.id === feature.menu)?.label;
  return { ...feature, stage, unavailable: feature.unavailable ?? featureDestinationById(feature.targetId)?.unavailable, location: feature.surface ? 'Help' : stageLabel ?? (menuLabel ? `${menuLabel} menu` : 'Commands') };
};

/** Read-only planning: the ordinary failed-navigation path writes processing state. */
export const planFeatureReveal = (id: FeatureId, project: ProjectState, currentStage: AppStage) => {
  const feature = featureDestinationById(id);
  if (!feature) return { ok: false as const, message: 'Feature unavailable.' };
  const destination = resolveFeatureDestination(feature, currentStage);
  if (destination.stage) {
    const gate = handoffGate(project, destination.stage);
    if (!gate.ok) {
      const message = gate.recoveryStage === 'design' ? 'Fix the mechanism in Design first.'
        : project.partOrder.length ? 'Add character joints first.' : 'Load a character first.';
      return { ok: false as const, message };
    }
  }
  return { ok: true as const, destination };
};

export const validateFeatureDestinations = () => {
  const errors: string[] = [];
  const ids = new Set<FeatureId>();
  FEATURE_DESTINATIONS.forEach(feature => {
    if (ids.has(feature.id)) errors.push(`Duplicate feature: ${feature.id}`);
    ids.add(feature.id);
    if (feature.commandId && commandById(feature.commandId).menuVisible === false) errors.push(`Hidden command: ${feature.commandId}`);
    if (!feature.label || (!feature.stage && !feature.menu && !feature.surface)) errors.push(`Missing destination: ${feature.id}`);
  });
  FEATURE_DESTINATIONS.forEach(feature => {
    if (!ids.has(feature.targetId)) errors.push(`Unknown target: ${feature.targetId}`);
  });
  return errors;
};
