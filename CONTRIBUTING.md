# Contributing

Thanks for your interest in splitterm.

## Development

```sh
npm install
npm start
```

Before pushing, run `npm run verify && npm test`. CI runs these on an `ubuntu` + `windows` matrix,
plus a Windows end-to-end build (`npm run package && npm run test:e2e`).

## Architecture guardrails

splitterm uses a strict four-process model with a compile-time contract spine in `src/shared` and a
**two-tier import firewall** (dependency-cruiser + ESLint) that enforces process isolation.
`npm run dep:check` must pass — the rules in `.dependency-cruiser.cjs` are enforced, not aspirational:

- `src/shared` is a pure leaf: no Electron, no `node-pty`, and no imports from the app rings.
- The four processes (`main` / `pty-host` / `preload` / `renderer`) communicate **only** via the
  typed contracts in `src/shared/ipc` — never by importing each other's internals.
- The renderer is sandboxed: no node built-ins, no Electron, no `node-pty`. It reaches the OS only
  through `window.splitterm` (preload).

When changing an IPC payload, update its type in `src/shared` — every process that uses it will then
fail to compile until it's updated too. That's the point.

## Commits & PRs

- Conventional-commit prefixes (`feat:`, `fix:`, `refactor:`, `chore:`, `ci:`).
- Keep PRs focused; include tests for logic changes; let CI (and any reviewer) go green before merge.
