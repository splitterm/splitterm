// Shell profiles. `ShellProfile` (id + label) is what the new-terminal dropdown lists.
// `UserProfile` is a saved, user-defined launcher: a base shell + optional startup command + name.
export interface ShellProfile {
  id: string;
  label: string;
}

export interface UserProfile {
  id: string;
  name: string;
  /** id of the detected shell this profile launches on (e.g. 'pwsh') */
  baseShellId: string;
  /** optional command run once the shell is ready (e.g. 'claude') */
  startupCommand?: string;
}
