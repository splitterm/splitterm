import { describe, it, expect } from 'vitest';
import { asTermId } from '../ids';
import {
  leaf,
  splitLeaf,
  closeLeaf,
  collectLeaves,
  findLeaf,
  normalizeSession,
  EMPTY_SESSION,
  type SplitNode,
  type SessionV1,
} from './layout-tree';

const L = (id: string, t = 1) => leaf(id, asTermId(t));

describe('layout-tree', () => {
  it('splits a root leaf into a 2-child split', () => {
    const root = splitLeaf(L('a', 1), 'a', 'row', L('b', 2));
    expect(root.type).toBe('split');
    const s = root as SplitNode;
    expect(s.dir).toBe('row');
    expect(collectLeaves(s).map((n) => n.id)).toEqual(['a', 'b']);
    expect(s.ratios).toEqual([0.5, 0.5]);
  });

  it('splices into a same-direction parent instead of nesting', () => {
    let root = splitLeaf(L('a'), 'a', 'row', L('b'));
    root = splitLeaf(root, 'b', 'row', L('c'));
    const s = root as SplitNode;
    expect(s.type).toBe('split');
    expect(s.children.every((c) => c.type === 'leaf')).toBe(true); // flat, not nested
    expect(s.children).toHaveLength(3);
    expect(s.ratios).toHaveLength(3);
    expect(Math.abs(s.ratios.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(1e-9);
    // siblings stay equal (gleichmäßig), not progressively halved
    s.ratios.forEach((r) => expect(r).toBeCloseTo(1 / 3, 6));
  });

  it('nests a sub-split when splitting in the cross direction', () => {
    let root = splitLeaf(L('a'), 'a', 'row', L('b'));
    root = splitLeaf(root, 'b', 'col', L('c'));
    const s = root as SplitNode;
    expect(s.children).toHaveLength(2);
    expect(s.children[1]!.type).toBe('split'); // b became a col sub-split
  });

  it('closes a leaf and collapses the single-child parent', () => {
    const root = splitLeaf(L('a'), 'a', 'row', L('b'));
    const after = closeLeaf(root, 'b');
    expect(after).not.toBeNull();
    expect(after!.type).toBe('leaf');
    expect((after as { id: string }).id).toBe('a');
  });

  it('returns null when the last leaf is closed', () => {
    expect(closeLeaf(L('a'), 'a')).toBeNull();
  });

  it('findLeaf locates a nested leaf', () => {
    let root = splitLeaf(L('a'), 'a', 'row', L('b'));
    root = splitLeaf(root, 'b', 'col', L('c'));
    expect(findLeaf(root, 'c')?.id).toBe('c');
    expect(findLeaf(root, 'zzz')).toBeNull();
  });
});

describe('normalizeSession', () => {
  it('returns the empty session for garbage / wrong version', () => {
    expect(normalizeSession(null)).toEqual(EMPTY_SESSION);
    expect(normalizeSession('nope')).toEqual(EMPTY_SESSION);
    expect(normalizeSession({ v: 2, root: null })).toEqual(EMPTY_SESSION);
    expect(normalizeSession({})).toEqual(EMPTY_SESSION);
  });

  it('accepts a null-root session (nothing to restore)', () => {
    const s = normalizeSession({ v: 1, root: null, focusedLeafId: null, maximizedId: null, leaves: {} });
    expect(s.root).toBeNull();
  });

  it('preserves a well-formed split tree, leaves, focus and maximized state', () => {
    const input: SessionV1 = {
      v: 1,
      root: {
        type: 'split',
        dir: 'row',
        children: [L('a', 1), L('b', 2)],
        ratios: [0.3, 0.7],
      },
      focusedLeafId: 'b',
      maximizedId: null,
      leaves: { a: { cwd: 'C:/x', profileId: 'p1', title: 'A' }, b: { cwd: '/home' } },
    };
    const s = normalizeSession(input);
    expect(s.root?.type).toBe('split');
    expect(collectLeaves(s.root!).map((n) => n.id)).toEqual(['a', 'b']);
    expect((s.root as SplitNode).ratios).toEqual([0.3, 0.7]);
    expect(s.focusedLeafId).toBe('b');
    expect(s.leaves.a).toEqual({ cwd: 'C:/x', profileId: 'p1', title: 'A' });
  });

  it('drops the whole tree when a node is malformed', () => {
    expect(normalizeSession({ v: 1, root: { type: 'leaf' } }).root).toBeNull(); // leaf without id
    expect(normalizeSession({ v: 1, root: { type: 'bogus' } }).root).toBeNull();
    expect(
      normalizeSession({ v: 1, root: { type: 'split', dir: 'row', children: [L('a')], ratios: [1] } }).root,
    ).toBeNull(); // split needs >= 2 children
  });

  it('renormalizes bad ratios to an even split', () => {
    const s = normalizeSession({
      v: 1,
      root: { type: 'split', dir: 'col', children: [L('a'), L('b')], ratios: [0, -1] },
    });
    expect((s.root as SplitNode).ratios).toEqual([0.5, 0.5]);
  });

  it('drops malformed leaf metadata but keeps the rest', () => {
    const s = normalizeSession({
      v: 1,
      root: L('a'),
      leaves: { a: { cwd: 5, profileId: 'p' }, b: 'nope' },
    });
    expect(s.leaves.a).toEqual({ profileId: 'p' }); // numeric cwd dropped
    expect(s.leaves.b).toBeUndefined();
  });

  it('drops a tree with duplicate leaf ids (would corrupt focus/close bookkeeping)', () => {
    const dup = { type: 'split', dir: 'row', children: [L('a'), L('a')], ratios: [0.5, 0.5] };
    expect(normalizeSession({ v: 1, root: dup }).root).toBeNull();
  });

  it('drops a tree that exceeds the leaf cap', () => {
    const children = Array.from({ length: 200 }, (_, i) => L(`leaf-${i}`));
    const huge = { type: 'split', dir: 'row', children, ratios: children.map(() => 1 / children.length) };
    expect(normalizeSession({ v: 1, root: huge }).root).toBeNull();
  });

  it('a "__proto__" leaf key becomes a real own property, not a prototype', () => {
    // JSON.parse gives __proto__ as an own enumerable property (exactly how loadSession reads the file).
    const input = JSON.parse('{"v":1,"root":{"type":"leaf","id":"a","termId":1},"leaves":{"__proto__":{"cwd":"C:/x"}}}');
    const s = normalizeSession(input);
    expect(Object.getPrototypeOf(s.leaves)).toBeNull(); // null-prototype map (no reparenting)
    expect(Object.prototype.hasOwnProperty.call(s.leaves, '__proto__')).toBe(true);
    expect((s.leaves as Record<string, { cwd?: string }>)['__proto__']).toEqual({ cwd: 'C:/x' });
  });
});
