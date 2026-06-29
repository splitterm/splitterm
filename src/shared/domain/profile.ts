// Shell profiles. `ShellProfile` (id + label) is what the new-terminal dropdown lists.
// `UserProfile` is a saved, user-defined launcher: a base shell + optional startup command + name.
import type { ProfileStatus } from './status-appearance';

export interface ShellProfile {
  id: string;
  label: string;
}

export interface UserProfile {
  id: string;
  name: string;
  /** id of the detected shell this profile launches on (e.g. 'pwsh') */
  baseShellId: string;
  /** commands run in order once the shell is ready on a FRESH open (e.g. ['claude']) */
  startupCommands?: string[];
  /**
   * commands run in order when the pane is reopened via session restore, instead of startupCommands
   * (e.g. ['claude --continue']). Falls back to startupCommands when unset, so existing profiles keep
   * their current behavior.
   */
  restoreCommands?: string[];
  /** per-profile sidebar status override (colour / animation / on-off); absent = global defaults */
  status?: ProfileStatus;
}
