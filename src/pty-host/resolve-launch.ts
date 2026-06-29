// Pure profile-resolution, extracted from host.ts so it's unit-testable without the utilityProcess
// wiring. Maps a profile id to a launchable shell + startup command.
import type { UserProfile } from '@shared/domain/profile';
import type { ResolvedShell, ShellProfileFull } from './shell-detect';

export interface ResolvedLaunch extends ResolvedShell {
  startupCommands?: string[];
}

/**
 * Resolve a profile id (a detected shell OR a user profile) to a launchable shell + the command
 * sequence to run once it's ready. With no explicit id (the "+" button), fall back to the configured
 * default profile, then the OS shell (`fallback`). A user profile whose base shell can't be found also
 * uses the fallback. When `restore` is true, a profile's `restoreCommands` are used instead of its
 * `startupCommands` (falling back to startup when no restore sequence is set). When `noCommands` is true
 * (restore-path-only mode), NO command sequence is run — only the shell + cwd are restored. Pure.
 */
export function resolveLaunch(
  profileId: string | undefined,
  detected: ShellProfileFull[],
  userProfiles: UserProfile[],
  defaultProfileId: string,
  fallback: () => ResolvedShell,
  restore = false,
  noCommands = false,
): ResolvedLaunch {
  const effective = profileId || defaultProfileId;
  if (effective) {
    const shell = detected.find((x) => x.id === effective);
    if (shell) return { file: shell.file, args: shell.args };
    const user = userProfiles.find((x) => x.id === effective);
    if (user) {
      const base = detected.find((x) => x.id === user.baseShellId);
      const baseShell = base ? { file: base.file, args: base.args } : fallback();
      const startupCommands = noCommands
        ? undefined
        : restore && user.restoreCommands?.length
          ? user.restoreCommands
          : user.startupCommands;
      return { ...baseShell, startupCommands };
    }
    console.warn(`[pty-host] unknown profile "${effective}", using default shell`);
  }
  return fallback();
}
