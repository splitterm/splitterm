// Renderer composition root:
//   topbar (sidebar toggle + brand + new-terminal + settings gear)
//   body (Sessions sidebar drawer | tiles)
//   statusbar
// Settings live in a dedicated modal (topbar gear / Ctrl+,); the sidebar is the Sessions list.
import '../styles/tokens.css';
import '../styles/base.css';
import { ipc } from '@platform/ipc-client';
import { initPortBridge } from '@platform/pty-port';
import { initSettings, getSettings } from '@platform/settings-controller';
import { createTiling, type Tiling } from '@features/tiling';
import { createTopbar } from '../chrome/topbar';
import { createSidebar } from '../chrome/sidebar';
import { createSettingsModal } from '../chrome/settings';

// Start listening for the PTY firehose port before anything spawns.
initPortBridge();

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

// Body is a push layout: [sidebar | tiles]. The sidebar column animates open and shifts the
// tiles right. Toggled from the topbar's far-left icon.
const body = document.createElement('main');
body.className = 'body';
const tilingHost = document.createElement('div');
tilingHost.className = 'terminal-host';

let tiling: Tiling | null = null;

const settingsModal = createSettingsModal();

const sidebar = createSidebar(body, {
  onFocusPane: (leafId) => tiling?.focusPane(leafId),
  onClosePane: (leafId) => tiling?.closePane(leafId),
  // Yield Escape to whatever layer owns it: the settings modal, or a focused terminal search bar
  // (its own bubble-phase Escape closes it; the sidebar must not swallow that keystroke first).
  isBlocked: () => settingsModal.isOpen() || document.activeElement?.closest('.term-search') != null,
});

const topbar = createTopbar({
  onToggleSidebar: () => sidebar.toggle(),
  onNewTerminal: () => void openDefaultTerminal(),
  onPickProfile: (id, label) => void tiling?.addTerminal(id, label),
  onRemoveTerminal: () => tiling?.removeLast(),
  onOpenSettings: () => settingsModal.open(),
});

// The "+" opens the configured default profile, titled with its display name. When no default
// profile is set (the common case), there's no label to resolve, so spawn immediately rather than
// awaiting shell-profile detection — that can shell out to `wsl.exe` on Windows and would otherwise
// block the first terminal for seconds. Only when a default profile IS set do we await profiles() to
// resolve its name (and detection is usually already done by the time the user clicks).
async function openDefaultTerminal(): Promise<void> {
  const settings = getSettings();
  const id = settings.defaultProfileId;
  if (!id) {
    await tiling?.addTerminal(undefined, '');
    return;
  }
  const detected = await ipc.pty.profiles().catch(() => []);
  const label = detected.find((d) => d.id === id)?.label ?? settings.profiles.find((p) => p.id === id)?.name ?? '';
  await tiling?.addTerminal(id, label);
}

body.append(sidebar.panel, tilingHost); // column 1 = sidebar, column 2 = tiles

const statusbar = document.createElement('footer');
statusbar.className = 'statusbar';
statusbar.innerHTML = `
  <span class="statusbar__item" id="shell-status">starting…</span>
  <span class="statusbar__item statusbar__version" id="version"></span>
`;

root.replaceChildren(topbar, body, statusbar);
document.body.appendChild(settingsModal.el); // fixed overlay, mounted at the document root

// Ctrl+, toggles settings (JetBrains/VS Code convention). Capture phase so it never reaches xterm.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === 'Comma') {
      e.preventDefault();
      e.stopPropagation();
      settingsModal.toggle();
    }
  },
  { capture: true },
);

// Apply settings (theme/motion) before creating the tiling so the first paint is themed and new
// terminals read live values. Then feed the Sessions sidebar from the tiling's change stream.
initSettings()
  .then(() => createTiling(tilingHost))
  .then(async (t) => {
    tiling = t;
    tiling.onChange((list) => sidebar.setSessions(list));

    // Restore the previous layout (fresh shells in the saved cwds/profiles) before subscribing the
    // save, so the restore isn't immediately persisted back over itself. The setting gates the WHOLE
    // feature: when off we neither restore nor save, so the last-saved layout is preserved (frozen).
    if (getSettings().restoreSession) {
      const saved = await ipc.session.get().catch(() => null);
      if (saved?.root) await t.restore(saved);
    }

    // Persist on change/unload, but never let a restore-off or empty session overwrite the saved
    // layout: skip the save while restore is off (frozen), and skip an empty (root === null) snapshot
    // so closing all panes / toggling restore on while empty can't clobber the stored layout.
    const persist = (): void => {
      if (!getSettings().restoreSession) return;
      const session = t.serialize();
      if (session.root) ipc.session.save(session);
    };
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let primed = false; // onChange fires once synchronously on subscribe — skip that initial no-op save
    const scheduleSave = (): void => {
      if (!primed) {
        primed = true;
        return;
      }
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 400);
    };
    // Persist on structural changes only — a 'cosmetic' change (live title / activity status) refreshes
    // the sidebar but isn't part of the saved session, so it must not drive saves (or scrollback serialize).
    tiling.onChange((_list, reason) => {
      if (reason !== 'cosmetic') scheduleSave();
    });
    window.addEventListener('pagehide', persist); // final save on unload (close/reload)

    const status = document.getElementById('shell-status');
    if (status) status.textContent = 'ready';
  })
  .catch((err) => {
    const status = document.getElementById('shell-status');
    if (status) status.textContent = `terminal failed: ${String(err)}`;
  });

ipc.app
  .version()
  .then((v) => {
    const el = document.getElementById('version');
    if (el) el.textContent = `v${v}`;
  })
  .catch(() => {
    /* non-fatal */
  });
