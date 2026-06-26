// The IPC spine barrel — the ONLY import surface other processes use for the contract.
export * from './channels';
export * from './control.contract';
export * from './port.protocol';
export * from './settings.contract';

import type { SpawnRequest, SpawnResponse, KillRequest } from './control.contract';
import type { SettingsApi } from './settings.contract';
import type { ShellProfile } from '../domain/profile';

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
  app: {
    version(): Promise<string>;
  };
}
