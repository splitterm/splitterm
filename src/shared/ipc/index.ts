// The IPC spine barrel — the ONLY import surface other processes use for the contract.
export * from './channels';
export * from './control.contract';
export * from './port.protocol';
export * from './settings.contract';

import type { SpawnRequest, SpawnResponse, KillRequest } from './control.contract';
import type { SettingsApi } from './settings.contract';
import type { ShellProfile } from '../domain/profile';
import type { SessionV1 } from '../domain/layout-tree';

export type { ShellProfile } from '../domain/profile';

/**
 * The exact object exposed on `window.splitterm` by the preload contextBridge.
 * preload builds it `satisfies SplittermApi`; the renderer consumes `window.splitterm`.
 *
 * The PTY byte firehose (MessagePort) is intentionally NOT here — it is delivered to the
 * page via a preload `window.postMessage` bridge in M1, not as a contextBridge function.
 */
export interface SplittermApi {
  pty: {
    spawn(req: SpawnRequest): Promise<SpawnResponse>;
    kill(req: KillRequest): Promise<void>;
    profiles(): Promise<ShellProfile[]>;
    /** Subscribe to pty-host crashes; returns an unsubscribe fn. */
    onHostCrashed(cb: () => void): () => void;
  };
  settings: SettingsApi;
  clipboard: {
    /** read the OS clipboard as plain text (terminal paste) */
    readText(): Promise<string>;
    /** write plain text to the OS clipboard (terminal copy) */
    writeText(text: string): Promise<void>;
  };
  session: {
    /** the persisted layout to restore on launch (root === null = nothing saved) */
    get(): Promise<SessionV1>;
    /** persist the current layout (debounced + flushed on quit by main) */
    save(session: SessionV1): void;
  };
  app: {
    version(): Promise<string>;
    /** theme applied + first splash frame painted — main shows the window (deferred from ready-to-show
        so it never flashes the default-dark splash before the real theme is set) */
    bootReady(): void;
    /** the boot splash finished — main reveals the native window controls (hidden during boot) */
    splashDone(): void;
  };
  /**
   * Boot-time appearance snapshot, injected synchronously by the preload (via the window's
   * additionalArguments) so the splash and the first paint can be themed BEFORE the real settings
   * arrive over async IPC. The renderer resolves `theme`/`followOS` against the OS colour scheme
   * exactly as settings-controller does; settings-controller then re-asserts the same values.
   */
  boot: {
    /** persisted theme name (e.g. 'Dark' | 'OLED Black' | 'Light' | a user scheme) */
    theme: string;
    followOS: boolean;
    reduceMotion: boolean;
  };
}
