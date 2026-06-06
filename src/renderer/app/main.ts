// Renderer composition root. M1 + topbar/sidebar chrome:
//   topbar (sidebar toggle + brand) / body (terminal + sidebar drawer overlay) / statusbar.
import '../styles/tokens.css';
import '../styles/base.css';
import { ipc } from '@platform/ipc-client';
import { initPortBridge } from '@platform/pty-port';
import { createTiling, type Tiling } from '@features/tiling';
import { createTopbar } from '../chrome/topbar';
import { createSidebar } from '../chrome/sidebar';

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
const sidebar = createSidebar(body);
const topbar = createTopbar({
  onToggleSidebar: () => sidebar.toggle(),
  onNewTerminal: () => void tiling?.addTerminal(),
  onPickProfile: (id) => void tiling?.addTerminal(id),
  onRemoveTerminal: () => tiling?.removeLast(),
});

body.append(sidebar.panel, tilingHost); // column 1 = sidebar, column 2 = tiles

const statusbar = document.createElement('footer');
statusbar.className = 'statusbar';
statusbar.innerHTML = `
  <span class="statusbar__item" id="shell-status">starting…</span>
  <span class="statusbar__item statusbar__version" id="version"></span>
`;

root.replaceChildren(topbar, body, statusbar);

createTiling(tilingHost)
  .then((t) => {
    tiling = t;
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
