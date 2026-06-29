import { describe, it, expect, vi } from 'vitest';
import { resolveLaunch } from './resolve-launch';
import type { ShellProfileFull, ResolvedShell } from './shell-detect';
import type { UserProfile } from '../shared/domain/profile';

const detected: ShellProfileFull[] = [
  { id: 'pwsh', label: 'PowerShell 7', file: 'pwsh.exe', args: [] },
  { id: 'cmd', label: 'Command Prompt', file: 'cmd.exe', args: [] },
];
const userProfiles: UserProfile[] = [
  { id: 'u1', name: 'Claude', baseShellId: 'pwsh', startupCommands: ['claude'], restoreCommands: ['claude --continue'] },
  { id: 'u2', name: 'Orphan', baseShellId: 'gone', startupCommands: ['x'] },
];
const OS: ResolvedShell = { file: 'os-shell', args: ['-l'] };
const resolve = (profileId: string | undefined, dflt = '', restore = false): ResolvedShell & { startupCommands?: string[] } =>
  resolveLaunch(profileId, detected, userProfiles, dflt, () => OS, restore);

describe('resolveLaunch', () => {
  it('resolves a detected shell by id', () => {
    expect(resolve('pwsh')).toEqual({ file: 'pwsh.exe', args: [] });
  });

  it('resolves a user profile to its base shell + startup sequence', () => {
    expect(resolve('u1')).toEqual({ file: 'pwsh.exe', args: [], startupCommands: ['claude'] });
  });

  it('falls back when a user profile base shell is missing (keeps the startup sequence)', () => {
    expect(resolve('u2')).toEqual({ file: 'os-shell', args: ['-l'], startupCommands: ['x'] });
  });

  it('uses the restore sequence when restoring, and falls back to startup when none is set', () => {
    expect(resolve('u1', '', true)).toEqual({ file: 'pwsh.exe', args: [], startupCommands: ['claude --continue'] });
    expect(resolve('u2', '', true)).toEqual({ file: 'os-shell', args: ['-l'], startupCommands: ['x'] }); // no restoreCommands → startup
  });

  it('runs NO command sequence in path-only mode (noCommands), even on restore — just the shell', () => {
    const pathOnly = (id: string, restore: boolean) => resolveLaunch(id, detected, userProfiles, '', () => OS, restore, true);
    expect(pathOnly('u1', false).file).toBe('pwsh.exe'); // shell still resolved
    expect(pathOnly('u1', false).startupCommands).toBeUndefined(); // but no startup commands
    expect(pathOnly('u1', true).startupCommands).toBeUndefined(); // and no restore commands
  });

  it('uses the default profile when no id is given', () => {
    expect(resolve(undefined, 'cmd')).toEqual({ file: 'cmd.exe', args: [] });
    expect(resolve(undefined, 'u1')).toEqual({ file: 'pwsh.exe', args: [], startupCommands: ['claude'] });
  });

  it('falls back to the OS shell when there is no id and no default', () => {
    expect(resolve(undefined, '')).toEqual(OS);
  });

  it('an explicit id overrides the default', () => {
    expect(resolve('pwsh', 'cmd')).toEqual({ file: 'pwsh.exe', args: [] });
  });

  it('falls back (with a warning) for an unknown id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolve('nope')).toEqual(OS);
    expect(resolve(undefined, 'also-nope')).toEqual(OS);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
