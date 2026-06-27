// Single source of truth for ipcMain channel names (low-rate control plane).
// The high-rate PTY byte firehose does NOT use these — it rides a direct MessagePort
// (see ./port.protocol.ts).

export const CONTROL_CHANNELS = {
  ptySpawn: 'pty:spawn',
  ptyKill: 'pty:kill',
  /** renderer → main: list detected shell profiles */
  ptyProfiles: 'pty:profiles',
  /** main → renderer: hands over the MessagePort for a terminal's byte firehose */
  ptyPort: 'pty:port',
  /** main → renderer: the pty-host crashed; every live session is gone (panes should show a banner) */
  ptyHostCrashed: 'pty:host-crashed',

  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  /** main → renderer broadcast after a settings change (UI or external edit) */
  settingsChanged: 'settings:changed',

  /** renderer → main: OS clipboard read/write (terminal copy/paste) */
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',

  /** renderer ↔ main: persisted window layout (session restore) */
  sessionGet: 'session:get',
  sessionSave: 'session:save',

  appVersion: 'app:version',
} as const;

export type ControlChannel = (typeof CONTROL_CHANNELS)[keyof typeof CONTROL_CHANNELS];
