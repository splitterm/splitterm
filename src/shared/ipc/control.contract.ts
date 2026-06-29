// Typed request/response shapes for the low-rate control channels.
// Imported by main (handlers), preload (bridge), and renderer (client) so a changed
// payload is a compile error in every process at once.
import type { TermId } from '../ids';

export interface SpawnRequest {
  /** profile GUID to launch; falls back to the default profile when omitted */
  profileId?: string;
  cwd?: string;
  cols: number;
  rows: number;
  /** inject OSC 7 cwd reporting into PowerShell (so cwd-on-split works on a stock prompt) */
  shellIntegration?: boolean;
  /** this pane is being reopened by session restore — run the profile's restore sequence, not startup */
  restore?: boolean;
  /** suppress the profile's startup/restore command sequence entirely (restore-path-only mode) */
  noCommands?: boolean;
}
export interface SpawnResponse {
  id: TermId;
  /** the pty-host has crash-looped and given up; no firehose output will arrive — banner the pane */
  hostDown?: boolean;
}

export interface KillRequest {
  id: TermId;
}
