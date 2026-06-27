import { describe, it, expect } from 'vitest';
import { withShellIntegration, __test } from './shell-integration';

const decode = (b64: string): string => Buffer.from(b64, 'base64').toString('utf16le');

describe('isPowerShell', () => {
  it('matches pwsh / powershell exes by basename or full path', () => {
    expect(__test.isPowerShell('powershell.exe')).toBe(true);
    expect(__test.isPowerShell('pwsh.exe')).toBe(true);
    expect(__test.isPowerShell('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe(true);
    expect(__test.isPowerShell('/usr/bin/pwsh')).toBe(true);
  });
  it('does not match other shells (or look-alike names)', () => {
    expect(__test.isPowerShell('cmd.exe')).toBe(false);
    expect(__test.isPowerShell('/bin/bash')).toBe(false);
    expect(__test.isPowerShell('wsl.exe')).toBe(false);
    expect(__test.isPowerShell('mypowershell.exe')).toBe(false);
  });
});

describe('withShellIntegration', () => {
  it('leaves non-PowerShell shells unchanged', () => {
    const sh = { file: 'C:\\Windows\\System32\\cmd.exe', args: [] };
    expect(withShellIntegration(sh, true)).toEqual(sh);
  });
  it('leaves PowerShell unchanged when disabled', () => {
    const sh = { file: 'powershell.exe', args: ['-NoLogo'] };
    expect(withShellIntegration(sh, false)).toEqual(sh);
  });
  it('appends -NoExit -EncodedCommand for PowerShell when enabled (preserving existing args)', () => {
    const sh = { file: 'powershell.exe', args: ['-NoLogo'] };
    const out = withShellIntegration(sh, true);
    expect(out.file).toBe('powershell.exe');
    expect(out.args.slice(0, 2)).toEqual(['-NoLogo', '-NoExit']);
    expect(out.args[2]).toBe('-EncodedCommand');
    expect(typeof out.args[3]).toBe('string');
  });
  it('the encoded command decodes to a profile-preserving OSC 7 prompt wrapper', () => {
    const out = withShellIntegration({ file: 'pwsh.exe', args: [] }, true);
    const script = decode(out.args[out.args.indexOf('-EncodedCommand') + 1]!);
    expect(script).toContain(']7;'); // OSC 7 introducer
    expect(script).toContain('.AbsoluteUri'); // canonical, percent-encoded file URI
    expect(script).toContain('function global:prompt'); // redefines the prompt
    expect(script).toContain('$__sp = $function:prompt'); // captures the existing prompt
    expect(script).toContain('& $__sp'); // calls it (preserves a custom prompt)
    expect(script).toContain('FileSystem'); // only emits for filesystem locations
    expect(script).toContain('catch'); // guarded so a locked-down session can't break the prompt
  });
});
