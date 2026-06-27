// Optional shell integration: make stock PowerShell report its cwd via OSC 7, so cwd-on-split works
// without the user configuring their prompt. We pass a prompt wrapper as -EncodedCommand (base64
// UTF-16LE — no arg-quoting issues) with -NoExit (stay interactive). Profiles still load (no
// -NoProfile), so a custom prompt is captured and wrapped, not clobbered; the OSC 7 emit is wrapped
// in try/catch so a locked-down session (ConstrainedLanguage) degrades to "no OSC 7, prompt intact".
import type { ResolvedShell } from './shell-detect';

// $__sp captures the existing prompt; the new prompt emits OSC 7 for filesystem locations then calls
// it. [uri]$path.AbsoluteUri builds a canonical, percent-encoded file URI (so '#', '%', spaces etc.
// round-trip through the renderer's decodeURIComponent, and UNC paths get the right file://server/…
// form) instead of hand-concatenating. Single line.
const POWERSHELL_OSC7 =
  `$__sp = $function:prompt; function global:prompt { ` +
  `try { $l = $ExecutionContext.SessionState.Path.CurrentLocation; ` +
  `if ($l.Provider.Name -eq 'FileSystem') { ` +
  `[Console]::Write([char]27 + ']7;' + ([uri]$l.ProviderPath).AbsoluteUri + [char]7) } } catch { }; ` +
  `if ($__sp) { & $__sp } else { 'PS ' + (Get-Location).Path + '> ' } }`;

const isPowerShell = (file: string): boolean => /(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i.test(file);

/**
 * Append PowerShell OSC 7 integration to the launch args when enabled and the shell is PowerShell;
 * otherwise return the shell unchanged. Pure.
 */
export function withShellIntegration(shell: ResolvedShell, enabled: boolean): ResolvedShell {
  if (!enabled || !isPowerShell(shell.file)) return shell;
  const encoded = Buffer.from(POWERSHELL_OSC7, 'utf16le').toString('base64');
  return { file: shell.file, args: [...shell.args, '-NoExit', '-EncodedCommand', encoded] };
}

// Exposed for unit tests only.
export const __test = { isPowerShell, POWERSHELL_OSC7 };
