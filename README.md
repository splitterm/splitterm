# splitterm

**A fast, lean tiling terminal.**

splitterm is an Electron terminal that splits into a tiling grid of panes, each running its own
shell. It's built around a strict four-process architecture for speed and isolation: terminal output
streams over a direct renderer↔pty-host channel and never passes through the main process.

> Status: in active development — Windows-first; macOS/Linux in progress.

## Features

- **Tiling panes** — split the window into a BSP grid; drag a pane's handle to swap it with another,
  drag a gutter to resize. xterm.js instances are re-parented across the layout without remounting,
  so scrollback and state survive every move.
- **Shell profiles** — detected shells (PowerShell, cmd, Git Bash, WSL, …) plus user-defined profiles
  (a base shell + an optional startup command). Pick one from the `▾` menu, or star one as the
  default that the `+` button opens.
- **Settings** — font, cursor, scrollback, and theme, persisted to a human-editable `settings.json`
  (atomic writes, validated and clamped on load).
- **Resilient** — output is bounded by watermark backpressure (a flood like `yes | cat` can't run
  away), and the pty-host is supervised: if it crashes it respawns, re-brokers its channel, and panes
  show a banner instead of silently freezing.

## Architecture

Four processes share one compile-time contract in `src/shared`, so any IPC payload change becomes a
compile error in every process at once:

| Process | Role |
|---------|------|
| **main** | app lifecycle, the frameless hardened window, settings persistence, pty-host supervision |
| **pty-host** | a single utility process hosting every `node-pty` session, streaming output with watermark backpressure |
| **preload** | the one frozen `window.splitterm` `contextBridge` surface |
| **renderer** | framework-less DOM: platform glue → terminal/tiling features → chrome/styles |

Terminal bytes ride a **direct renderer↔pty-host `MessagePort`**, brokered once by main — they never
traverse the main process. A two-tier **import firewall** (dependency-cruiser + ESLint) enforces
process isolation, and the security baseline is `contextIsolation` + `sandbox` + no `nodeIntegration`,
a narrow contextBridge, a `'self'`-only CSP (response header), navigation lockdown, and Electron fuses
(no RunAsNode/inspect, asar integrity).

## Getting started

```sh
npm install
npm start          # run in dev (Vite + Electron, with HMR)
```

### Build & test

```sh
npm run verify     # typecheck + lint + import-firewall (dependency-cruiser)
npm test           # unit tests (vitest)
npm run package    # build the app into .vite/build + out/
npm run test:e2e   # end-to-end smoke (Playwright drives the built app)
npm run make       # produce installers
```

## License

MIT © Timon-ok — see [LICENSE](LICENSE).
