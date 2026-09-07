import { useEffect, useRef, useState } from 'react';
import { APP_MENU_GROUPS, commandById, commandShortcutText, type AppCommandId } from '../../utils/appCommands';
import type { SupportMenuRequest } from '../../hooks/useStudentSupport';

export const TopCommandBar = ({ commandHandlers, menuRequest, hasNew = false }: {
  commandHandlers: Record<AppCommandId, () => void>;
  menuRequest?: SupportMenuRequest;
  hasNew?: boolean;
}) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);
  useEffect(() => { if (menuRequest) setOpenMenu(menuRequest.id); }, [menuRequest]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!nav.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
  const toggleMenu = (id: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    setOpenMenu(openMenu === id ? null : id);
  };
  const runCommand = (id: AppCommandId) => () => {
    commandHandlers[id]();
    setOpenMenu(null);
  };
  return <nav ref={nav} className="command-bar" aria-label="Commands" data-testid="top-command-bar" onKeyDown={event => {
    if (event.key === 'Escape' && openMenu) {
      event.stopPropagation();
      nav.current?.querySelector<HTMLElement>(`[data-testid="command-menu-${openMenu}"]`)?.focus();
      setOpenMenu(null);
    }
  }}>
    {APP_MENU_GROUPS.map(group => <details key={group.id} open={openMenu === group.id}>
      <summary data-testid={`command-menu-${group.id}`} onClick={toggleMenu(group.id)}>{group.label}</summary>
      <div className="command-menu">
        {group.commandIds.map(id => {
          const command = commandById(id);
          const shortcut = commandShortcutText(command);
          return <button key={id} data-command-id={id} data-feature-id={id} data-testid={command.testId ?? `command-${id.replaceAll('.', '-')}`} onClick={runCommand(id)}>
            <span>{command.label}</span>
            {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
          </button>;
        })}
      </div>
    </details>)}
    <div className="support-entries" aria-label="Support">
      <button type="button" className="support-entry support-find" data-testid="find-feature-entry"
        onClick={runCommand('help.findFeature')}>Find a feature</button>
      <button type="button" className="support-entry" data-testid="feedback-entry"
        onClick={runCommand('help.feedback')}>Feedback</button>
      <button type="button" className="support-entry" data-testid="whats-new-entry"
        onClick={runCommand('help.whatsNew')}>What's new{hasNew && <span className="support-new" data-testid="whats-new-badge">New</span>}</button>
    </div>
  </nav>;
};
