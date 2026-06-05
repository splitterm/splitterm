// Renderer composition root. M1 + topbar/sidebar chrome:
//   topbar (sidebar toggle + brand) / body (terminal + sidebar drawer overlay) / statusbar.
import '../styles/tokens.css';
import '../styles/base.css';
import { ipc } from '@platform/ipc-client';
import { initPortBridge } from '@platform/pty-port';
import { createTerminalTile } from '@features/terminal';
import { createTopbar } from '../chrome/topbar';
import { createSidebar } from '../chrome/sidebar';

// Start listening for the PTY firehose port before anything spawns.
initPortBridge();

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

// Sidebar drawer (empty for now) — toggled from the topbar's far-left icon.
const sidebar = createSidebar();
const topbar = createTopbar({ onToggleSidebar: () => sidebar.toggle() });

const body = document.createElement('main');
body.className = 'body';
const terminalHost = document.createElement('div');
terminalHost.className = 'terminal-host';
body.append(terminalHost, sidebar.element); // drawer overlays the terminal, no reflow

const statusbar = document.createElement('footer');
statusbar.className = 'statusbar';
statusbar.innerHTML = `
  <span class="statusbar__item" id="shell-status">starting…</span>
  <span class="statusbar__item statusbar__version" id="version"></span>
`;

root.replaceChildren(topbar, body, statusbar);

createTerminalTile(terminalHost)
  .then(() => {
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
