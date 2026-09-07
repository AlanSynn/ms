import type { AppStage } from '../types';

export type AppMenuId = 'file' | 'edit' | 'view' | 'go' | 'options' | 'help';

export type AppCommandSpec = {
  id: string;
  menu: AppMenuId;
  label: string;
  description: string;
  menuVisible?: boolean;
  shortcuts?: readonly string[];
  stageTarget?: AppStage;
  testId?: string;
};

const APP_COMMAND_DEFINITIONS = [
  { id: 'project.new', menu: 'file', label: 'New Project', description: 'Start new project.', shortcuts: ['Mod+N'] },
  { id: 'project.open', menu: 'file', label: 'Open Project', description: 'Open project file.', shortcuts: ['Mod+O'], testId: 'command-load-project' },
  { id: 'project.recoverAutosave', menu: 'file', label: 'Recover browser backup', description: 'Recover a browser backup after a problem.' },
  { id: 'project.save', menu: 'file', label: 'Save Project', description: 'Save project file.', shortcuts: ['Mod+S'], testId: 'command-download-snapshot' },
  { id: 'project.saveAs', menu: 'file', label: 'Download Snapshot As…', description: 'Legacy named snapshot.', menuVisible: false },
  { id: 'project.exportCopy', menu: 'file', label: 'Portable Copy', description: 'Legacy portable copy.', menuVisible: false },
  { id: 'project.exportBlueprint', menu: 'file', label: 'Export Blueprint', description: 'Legacy Blueprint handoff.', menuVisible: false },
  { id: 'project.resetLesson', menu: 'file', label: 'Reset Lesson', description: 'Restore lesson.', testId: 'command-reset-lesson' },

  { id: 'edit.undo', menu: 'edit', label: 'Undo', description: 'Undo.', shortcuts: ['Mod+Z'] },
  { id: 'edit.redo', menu: 'edit', label: 'Redo', description: 'Redo.', shortcuts: ['Mod+Shift+Z', 'Mod+Y'] },

  { id: 'view.zoomIn', menu: 'view', label: 'Zoom In', description: 'Zoom in.', shortcuts: ['Mod+='] },
  { id: 'view.zoomOut', menu: 'view', label: 'Zoom Out', description: 'Zoom out.', shortcuts: ['Mod+-'] },
  { id: 'view.fit', menu: 'view', label: 'Fit', description: 'Fit view.', shortcuts: ['Mod+0'] },
  { id: 'view.reset', menu: 'view', label: 'Reset View', description: 'Reset view.' },
  { id: 'workspace.saveLayout', menu: 'view', label: 'Save Layout', description: 'Save layout.' },
  { id: 'workspace.restoreLayout', menu: 'view', label: 'Restore Layout', description: 'Restore layout.' },
  { id: 'workspace.resetLayout', menu: 'view', label: 'Reset Layout', description: 'Reset layout.' },

  { id: 'stage.character', menu: 'go', label: 'Character', description: 'Character.', shortcuts: ['Alt+1'], stageTarget: 'character' },
  { id: 'stage.project', menu: 'go', label: 'Project', description: 'Project files.', stageTarget: 'project' },
  { id: 'stage.path', menu: 'go', label: 'Path', description: 'Path.', shortcuts: ['Alt+2'], stageTarget: 'path' },
  { id: 'stage.foundry', menu: 'go', label: 'Foundry', description: 'Foundry.', shortcuts: ['Alt+3'], stageTarget: 'foundry' },
  { id: 'stage.design', menu: 'go', label: 'Design', description: 'Design.', shortcuts: ['Alt+4'], stageTarget: 'design' },
  { id: 'stage.blueprint', menu: 'go', label: 'Blueprint', description: 'Build and print.', shortcuts: ['Alt+5'], stageTarget: 'blueprint' },
  { id: 'stage.assembly', menu: 'go', label: 'Assembly', description: 'Assembly.', shortcuts: ['Alt+6'], stageTarget: 'assembly' },

  { id: 'options.preferences', menu: 'options', label: 'Preferences…', description: 'Options.', shortcuts: ['Mod+,'], stageTarget: 'options' },

  { id: 'help.findFeature', menu: 'help', label: 'Find a feature', description: 'Find an existing control.' },
  { id: 'help.feedback', menu: 'help', label: 'Feedback', description: 'Send a problem or idea.' },
  { id: 'help.whatsNew', menu: 'help', label: "What's new", description: 'See updates in this version.' },
  { id: 'help.shortcuts', menu: 'help', label: 'Shortcuts', description: 'Shortcuts.', shortcuts: ['?'] },
  { id: 'help.about', menu: 'help', label: 'About MotionSmith…', description: 'About.' }
] as const satisfies readonly AppCommandSpec[];

export type AppCommandId = typeof APP_COMMAND_DEFINITIONS[number]['id'];
export type AppCommandHandlerMap = Record<AppCommandId, () => void>;
export type AppCommand = AppCommandSpec & { id: AppCommandId };
export const APP_COMMANDS = APP_COMMAND_DEFINITIONS as readonly AppCommand[];

export type AppMenuGroup = {
  id: AppMenuId;
  label: string;
  commandIds: readonly AppCommandId[];
};

export const APP_MENU_GROUPS = [
  { id: 'file', label: 'Project', commandIds: ['project.new', 'project.save', 'project.open', 'project.recoverAutosave', 'project.resetLesson'] },
  { id: 'edit', label: 'Edit', commandIds: ['edit.undo', 'edit.redo'] },
  { id: 'view', label: 'View', commandIds: ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.reset', 'workspace.saveLayout', 'workspace.restoreLayout', 'workspace.resetLayout'] },
  { id: 'go', label: 'Go', commandIds: ['stage.project', 'stage.character', 'stage.path', 'stage.foundry', 'stage.design', 'stage.blueprint', 'stage.assembly'] },
  { id: 'options', label: 'Options', commandIds: ['options.preferences'] },
  { id: 'help', label: 'Help', commandIds: ['help.findFeature', 'help.feedback', 'help.whatsNew', 'help.shortcuts', 'help.about'] }
] as const satisfies readonly AppMenuGroup[];

export const commandById = (id: AppCommandId) => APP_COMMANDS.find(command => command.id === id)!;

export const commandShortcutText = (command: Pick<AppCommandSpec, 'shortcuts'>, platform: 'mac' | 'pc' = defaultShortcutPlatform()) => {
  const shortcut = command.shortcuts?.[0];
  return shortcut ? formatShortcut(shortcut, platform) : '';
};

export const commandShortcutListText = (command: Pick<AppCommandSpec, 'shortcuts'>, platform: 'mac' | 'pc' = defaultShortcutPlatform()) =>
  (command.shortcuts ?? []).map(shortcut => formatShortcut(shortcut, platform)).join(' / ');

export const defaultShortcutPlatform = (): 'mac' | 'pc' => {
  if (typeof navigator === 'undefined') return 'pc';
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? 'mac' : 'pc';
};

const formatShortcut = (shortcut: string, platform: 'mac' | 'pc') => shortcut
  .split('+')
  .map(token => {
    if (token === 'Mod') return platform === 'mac' ? '⌘' : 'Ctrl';
    if (token === 'Shift') return platform === 'mac' ? '⇧' : 'Shift';
    if (token === 'Alt') return platform === 'mac' ? '⌥' : 'Alt';
    if (token === '=') return platform === 'mac' ? '+' : '=';
    return token.length === 1 ? token.toUpperCase() : token;
  })
  .join(platform === 'mac' ? '' : '+');

type KeyboardLikeEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

export const commandIdForKeyboardEvent = (event: KeyboardLikeEvent): AppCommandId | undefined =>
  APP_COMMANDS.find(command => command.shortcuts?.some(shortcut => shortcutMatchesEvent(shortcut, event)))?.id;

const shortcutMatchesEvent = (shortcut: string, event: KeyboardLikeEvent) => {
  const tokens = shortcut.split('+');
  const key = tokens[tokens.length - 1];
  const wantsMod = tokens.includes('Mod');
  const wantsShift = tokens.includes('Shift');
  const wantsAlt = tokens.includes('Alt');
  const pressedMod = event.ctrlKey || event.metaKey;
  const normalizedShortcutKey = normalizeShortcutKey(key);
  const normalizedEventKey = normalizeShortcutKey(event.key);
  const shiftedPlusForEquals = normalizedShortcutKey === '=' && event.shiftKey && (event.key === '+' || event.key === '=');
  if (wantsMod !== pressedMod) return false;
  if (wantsAlt !== event.altKey) return false;
  if (wantsShift !== event.shiftKey && key !== '?' && !shiftedPlusForEquals) return false;
  return normalizedEventKey === normalizedShortcutKey;
};

const normalizeShortcutKey = (key: string) => {
  if (key === '+') return '=';
  if (key === 'Esc') return 'escape';
  if (key === ' ') return 'space';
  return key.toLowerCase();
};

export const validateAppCommandRegistry = () => {
  const errors: string[] = [];
  const ids = new Set<string>();
  APP_COMMANDS.forEach(command => {
    if (ids.has(command.id)) errors.push(`duplicate command id: ${command.id}`);
    ids.add(command.id);
  });
  APP_MENU_GROUPS.forEach(group => {
    group.commandIds.forEach(id => {
      if (!ids.has(id)) errors.push(`menu ${group.id} references missing command: ${id}`);
    });
    const wrongMenu = group.commandIds.filter(id => commandById(id).menu !== group.id);
    wrongMenu.forEach(id => errors.push(`menu ${group.id} contains command from ${commandById(id).menu}: ${id}`));
  });
  const menuIds = new Set<AppCommandId>(APP_MENU_GROUPS.flatMap(group => group.commandIds));
  APP_COMMANDS.forEach(command => {
    if (command.menuVisible === false && menuIds.has(command.id)) errors.push(`hidden command is in a menu: ${command.id}`);
    if (command.menuVisible !== false && !menuIds.has(command.id)) errors.push(`command is not in a menu: ${command.id}`);
  });
  const shortcuts = new Map<string, string>();
  APP_COMMANDS.forEach(command => command.shortcuts?.forEach(shortcut => {
    const normalized = shortcut.toLowerCase();
    const existing = shortcuts.get(normalized);
    if (existing) errors.push(`shortcut ${shortcut} is shared by ${existing} and ${command.id}`);
    shortcuts.set(normalized, command.id);
  }));
  return errors;
};
