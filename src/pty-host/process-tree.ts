// A one-shot OS process-tree snapshot (child PID → parent PID) + an ancestor walk, used to correlate a
// Claude Code session's PID (from ~/.claude/sessions/<pid>.json) back to the pane whose shell spawned it:
// `claude` runs INSIDE a pane's pty shell, so the pane's shell PID is one of claude's ancestors. cwd
// alone can't disambiguate (two panes may share a directory) — the parent chain is the reliable link.
//
// Snapshotting shells out (Win32_Process via PowerShell on Windows, `ps` elsewhere), so it's done
// on-demand and cached by the caller, never per status poll. The parser + walk are pure (unit-tested);
// the exec wrapper is the only impure part.
import { execFile } from 'node:child_process';

/**
 * Parse a process listing into child→parent. Each non-empty line must contain at least two integers,
 * the first being the PID and the second its parent PID — true for BOTH our Windows CSV
 * (`"ProcessId","ParentProcessId"`) and POSIX `ps -axo pid=,ppid=` (`  pid ppid`) outputs, so one
 * tolerant parser covers both. Header/garbage lines (no two integers) are skipped.
 */
export function parseParentMap(stdout: string): Map<number, number> {
  const parents = new Map<number, number>();
  for (const line of stdout.split(/\r?\n/)) {
    const nums = line.match(/\d+/g);
    if (!nums || nums.length < 2) continue;
    const pid = Number(nums[0]);
    const ppid = Number(nums[1]);
    if (Number.isInteger(pid) && Number.isInteger(ppid)) parents.set(pid, ppid);
  }
  return parents;
}

/**
 * Walk up from `pid` and return the first ancestor (or `pid` itself) found in `targets`, else undefined.
 * Bounded depth + a seen-set guard against a cyclic/corrupt snapshot. PID 0/4 (system) terminate the walk.
 */
export function findAncestorIn(pid: number, parents: Map<number, number>, targets: Set<number>, maxDepth = 24): number | undefined {
  let cur = pid;
  const seen = new Set<number>();
  for (let i = 0; i <= maxDepth; i++) {
    if (targets.has(cur)) return cur;
    if (seen.has(cur)) return undefined;
    seen.add(cur);
    const parent = parents.get(cur);
    if (parent === undefined || parent === cur || parent === 0) return undefined;
    cur = parent;
  }
  return undefined;
}

// PowerShell is slow to start, so -NoProfile; CIM is the supported replacement for the removed wmic.
const WIN_PS_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation',
];

/** Snapshot the OS process tree as child→parent. Resolves to an empty map on any failure (correlation
 *  then simply finds nothing and retries on the next poll — never throws into the status loop). */
export function processParents(): Promise<Map<number, number>> {
  const win = process.platform === 'win32';
  const file = win ? 'powershell.exe' : 'ps';
  const args = win ? WIN_PS_ARGS : ['-axo', 'pid=,ppid='];
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 8000 }, (err, stdout) => {
      resolve(err ? new Map() : parseParentMap(stdout));
    });
  });
}
