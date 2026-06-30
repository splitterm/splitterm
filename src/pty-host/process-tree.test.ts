import { describe, it, expect } from 'vitest';
import { parseParentMap, findAncestorIn } from './process-tree';

describe('parseParentMap', () => {
  it('parses the Windows CSV (ProcessId,ParentProcessId), skipping the header', () => {
    const csv = '"ProcessId","ParentProcessId"\r\n"4","0"\r\n"1200","4"\r\n"3340","1200"\r\n';
    const m = parseParentMap(csv);
    expect(m.get(4)).toBe(0);
    expect(m.get(1200)).toBe(4);
    expect(m.get(3340)).toBe(1200);
    expect(m.has(0)).toBe(false); // the all-text header line contributes no entry
  });

  it('parses POSIX `ps -axo pid=,ppid=` whitespace columns', () => {
    const m = parseParentMap('    1     0\n  742     1\n 1055   742\n');
    expect(m.get(1)).toBe(0);
    expect(m.get(742)).toBe(1);
    expect(m.get(1055)).toBe(742);
  });

  it('skips lines without two integers', () => {
    const m = parseParentMap('header line\n\n  only-one 12\n 5 9 trailing\n');
    expect(m.get(5)).toBe(9); // "only-one 12" has a single integer → skipped
    expect(m.size).toBe(1);
  });

  it('returns empty for empty input', () => {
    expect(parseParentMap('').size).toBe(0);
  });
});

describe('findAncestorIn', () => {
  // claude(3340) → cmd(1200) → shell/pane(900) → 5 → 1 → 0
  const parents = new Map<number, number>([
    [3340, 1200],
    [1200, 900],
    [900, 5],
    [5, 1],
    [1, 0],
  ]);

  it('finds a multi-level ancestor in the target set (claude → pane shell)', () => {
    expect(findAncestorIn(3340, parents, new Set([900]))).toBe(900);
  });

  it('matches the pid itself when it is a target (depth 0 — needs no parent map)', () => {
    expect(findAncestorIn(900, new Map(), new Set([900]))).toBe(900);
  });

  it('returns undefined when no ancestor is a target', () => {
    expect(findAncestorIn(3340, parents, new Set([7777]))).toBeUndefined();
  });

  it('stops at the root (ppid 0) without matching it', () => {
    expect(findAncestorIn(3340, parents, new Set([0]))).toBeUndefined();
  });

  it('guards against a cyclic snapshot', () => {
    expect(findAncestorIn(10, new Map([[10, 20], [20, 10]]), new Set([999]))).toBeUndefined();
  });

  it('respects the depth bound', () => {
    const chain = new Map<number, number>();
    for (let i = 1; i <= 30; i++) chain.set(i, i + 1);
    expect(findAncestorIn(1, chain, new Set([29]), 5)).toBeUndefined();
    expect(findAncestorIn(1, chain, new Set([4]), 5)).toBe(4);
  });
});
