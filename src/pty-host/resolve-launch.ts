// Pure profile-resolution, extracted from host.ts so it's unit-testable without the utilityProcess
// wiring. Maps a profile id to a launchable shell + startup command.
import type { UserProfile } from '@shared/domain/profile';
import type { ResolvedShell, ShellProfileFull } from './shell-detect';

export interface ResolvedLaunch extends ResolvedShell {
  startupCommand?: string;
}

/**
 * Resolve a profile id (a detected shell OR a user profile) to a launchable shell + startup command.
 * With no explicit id (the "+" button), fall back to the configured default profile, then the OS
 * shell (`fallback`). A user profile whose base shell can't be found also uses the fallback. Pure.
 */
export function resolveLaunch(
  profileId: string | undefined,
  detected: ShellProfileFull[],
  userProfiles: UserProfile[],
  defaultProfileId: string,
  fallback: () => ResolvedShell,
): ResolvedLaunch {
  const effective = profileId || defaultProfileId;
  if (effective) {
    const shell = detected.find((x) => x.id === effective);
    if (shell) return { file: shell.file, args: shell.args };
    const user = userProfiles.find((x) => x.id === effective);
    if (user) {
      const base = detected.find((x) => x.id === user.baseShellId);
      const baseShell = base ? { file: base.file, args: base.args } : fallback();
      return { ...baseShell, startupCommand: user.startupCommand };
    }
    console.warn(`[pty-host] unknown profile "${effective}", using default shell`);
  }
  return fallback();
}
