import { useState } from 'react';
import { APP_MENU_GROUPS, commandById, commandShortcutText, type AppCommandId } from '../../utils/appCommands';

export const TopCommandBar = ({ commandHandlers }: { commandHandlers: Record<AppCommandId, () => void> }) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const toggleMenu = (id: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    setOpenMenu(openMenu === id ? null : id);
  };
  const runCommand = (id: AppCommandId) => () => {
    commandHandlers[id]();
    setOpenMenu(null);
  };
  return <nav className="command-bar" aria-label="Commands" data-testid="top-command-bar">
    {APP_MENU_GROUPS.map(group => <details key={group.id} open={openMenu === group.id}>
      <summary onClick={toggleMenu(group.id)}>{group.label}</summary>
      <div className="command-menu">
        {group.commandIds.map(id => {
          const command = commandById(id);
          const shortcut = commandShortcutText(command);
          return <button key={id} data-command-id={id} data-testid={command.testId ?? `command-${id.replaceAll('.', '-')}`} onClick={runCommand(id)}>
            <span>{command.label}</span>
            {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
          </button>;
        })}
      </div>
    </details>)}
  </nav>;
};
