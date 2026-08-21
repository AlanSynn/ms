import { APP_MENU_GROUPS, commandById, commandShortcutListText } from '../../utils/appCommands';

const APP_VERSION = __APP_VERSION__;

export const ShortcutHelpDialog = ({ onClose }: { onClose: () => void }) => <div className="modal-backdrop" onMouseDown={event => {
  if (event.target === event.currentTarget) onClose();
}}>
  <section role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title" className="modal-sheet shortcut-help-dialog" data-testid="shortcut-help-dialog">
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="accent-label">Commands</div>
        <h3 id="shortcut-help-title">Shortcuts</h3>
      </div>
      <button className="btn-secondary" onClick={onClose}>Close</button>
    </div>
    <div className="shortcut-help-grid">
      {APP_MENU_GROUPS.map(group => <section key={group.id} className="shortcut-help-group">
        <h4>{group.label}</h4>
        {group.commandIds.map(id => {
          const command = commandById(id);
          const shortcuts = commandShortcutListText(command);
          return <div key={id} className="shortcut-help-row">
            <span>{command.label}</span>
            <kbd>{shortcuts || 'menu'}</kbd>
          </div>;
        })}
      </section>)}
    </div>
  </section>
</div>;

export const AboutDialog = ({ onClose }: { onClose: () => void }) => <div className="modal-backdrop" onMouseDown={event => {
  if (event.target === event.currentTarget) onClose();
}}>
  <section role="dialog" aria-modal="true" aria-labelledby="about-title" className="modal-sheet shortcut-help-dialog" data-testid="about-dialog">
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="accent-label">About</div>
        <h3 id="about-title">MotionSmith</h3>
        <p className="mt-2 text-sm font-bold text-slate-500">Local only.</p>
      </div>
      <button className="btn-secondary" onClick={onClose}>Close</button>
    </div>
    <div className="shortcut-help-grid">
      <div className="shortcut-help-row"><span>Version</span><kbd>v{APP_VERSION}</kbd></div>
      <div className="shortcut-help-row"><span>Release</span><kbd>classroom static web</kbd></div>
      <div className="shortcut-help-row"><span>Data</span><kbd>browser autosave · files</kbd></div>
      <div className="shortcut-help-row"><span>Project</span><kbd>MotionSmith</kbd></div>
    </div>
  </section>
</div>;
