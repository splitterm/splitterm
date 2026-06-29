import { describe, it, expect } from 'vitest';
import { asTermId } from '../ids';
import {
  leaf,
  splitLeaf,
  closeLeaf,
  moveLeaf,
  equalizeRatios,
  collectLeaves,
  findLeaf,
  normalizeSession,
  EMPTY_SESSION,
  type LayoutNode,
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

  describe('splitLeaf before=true (leading side)', () => {
    it('puts the new leaf first when splitting a root leaf', () => {
      const s = splitLeaf(L('a'), 'a', 'row', L('b'), true) as SplitNode;
      expect(collectLeaves(s).map((n) => n.id)).toEqual(['b', 'a']);
    });

    it('splices before the target in a same-direction parent', () => {
      let root = splitLeaf(L('a'), 'a', 'row', L('b'));
      root = splitLeaf(root, 'b', 'row', L('c'), true); // insert c before b
      expect(collectLeaves(root).map((n) => n.id)).toEqual(['a', 'c', 'b']);
    });

    it('nests with the new leaf leading in the cross direction', () => {
      let root = splitLeaf(L('a'), 'a', 'row', L('b'));
      root = splitLeaf(root, 'b', 'col', L('c'), true);
      const sub = (root as SplitNode).children[1] as SplitNode;
      expect(sub.type).toBe('split');
      expect(collectLeaves(sub).map((n) => n.id)).toEqual(['c', 'b']); // c above b
    });
  });

  describe('equalizeRatios', () => {
    it('resets a flat split to even shares', () => {
      const root = { type: 'split', dir: 'row', children: [L('a'), L('b'), L('c')], ratios: [0.7, 0.2, 0.1] } as SplitNode;
      expect((equalizeRatios(root) as SplitNode).ratios.every((r) => Math.abs(r - 1 / 3) < 1e-9)).toBe(true);
    });
    it('evens every nested split and leaves a leaf untouched', () => {
      expect(equalizeRatios(L('a'))).toEqual(L('a'));
      const nested: LayoutNode = {
        type: 'split',
        dir: 'row',
        ratios: [0.9, 0.1],
        children: [L('a'), { type: 'split', dir: 'col', ratios: [0.8, 0.2], children: [L('b'), L('c')] }],
      };
      const out = equalizeRatios(nested) as SplitNode;
      expect(out.ratios).toEqual([0.5, 0.5]);
      expect((out.children[1] as SplitNode).ratios).toEqual([0.5, 0.5]);
      expect(collectLeaves(out).map((n) => n.id)).toEqual(['a', 'b', 'c']); // structure preserved
    });
  });

  describe('moveLeaf', () => {
    // row[a,b,c]
    const row3 = (): SplitNode => {
      let root = splitLeaf(L('a', 1), 'a', 'row', L('b', 2));
      root = splitLeaf(root, 'b', 'row', L('c', 3));
      return root as SplitNode;
    };

    it('is a no-op (same reference) for source===target or a missing id', () => {
      const root = row3();
      expect(moveLeaf(root, 'a', 'a', 'row', false)).toBe(root);
      expect(moveLeaf(root, 'zzz', 'a', 'row', false)).toBe(root);
      expect(moveLeaf(root, 'a', 'zzz', 'row', false)).toBe(root);
    });

    it('moves a leaf to the trailing side of the target, returning a NEW tree', () => {
      const root = row3();
      const after = moveLeaf(root, 'a', 'c', 'row', false); // a after c
      expect(after).not.toBe(root); // a real change yields a new ref — the renderer's no-op check needs this
      expect(collectLeaves(after).map((n) => n.id)).toEqual(['b', 'c', 'a']);
    });

    it('moves a leaf to the leading side of the target', () => {
      const after = moveLeaf(row3(), 'c', 'a', 'row', true); // c before a
      expect(collectLeaves(after).map((n) => n.id)).toEqual(['c', 'a', 'b']);
    });

    it('re-tiles into the perpendicular direction (2-pane collapse case)', () => {
      const row = splitLeaf(L('a', 1), 'a', 'row', L('b', 2)); // row[a,b]
      const after = moveLeaf(row, 'a', 'b', 'col', false) as SplitNode; // a below b
      expect(after.dir).toBe('col');
      expect(collectLeaves(after).map((n) => n.id)).toEqual(['b', 'a']);
    });

    it('preserves the moved leaf identity (id + termId)', () => {
      const after = moveLeaf(row3(), 'a', 'c', 'row', false);
      const moved = findLeaf(after, 'a');
      expect(moved?.termId).toBe(asTermId(1));
    });

    it('keeps exactly the same leaves and valid ratios', () => {
      const after = moveLeaf(row3(), 'a', 'c', 'row', false);
      expect(collectLeaves(after).map((n) => n.id).sort()).toEqual(['a', 'b', 'c']);
      const sum = (after as SplitNode).ratios.reduce((x, y) => x + y, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    });

    it('handles a nested topology: collapses the vacated sub-split and re-nests at the target', () => {
      // row[ col[a,b], c ] — move 'a' below 'c'.
      const nested: SplitNode = {
        type: 'split',
        dir: 'row',
        ratios: [0.5, 0.5],
        children: [
          { type: 'split', dir: 'col', ratios: [0.5, 0.5], children: [L('a', 1), L('b', 2)] },
          L('c', 3),
        ],
      };
      const after = moveLeaf(nested, 'a', 'c', 'col', false) as SplitNode; // a below c
      // col[a,b] loses a → collapses to leaf b; c becomes a col sub-split [c, a].
      expect(collectLeaves(after).map((n) => n.id)).toEqual(['b', 'c', 'a']);
      expect(findLeaf(after, 'a')?.termId).toBe(asTermId(1)); // identity preserved through the move
      expect(after.dir).toBe('row');
      expect(after.children).toHaveLength(2);
      expect(after.children[0]!.type).toBe('leaf'); // collapsed b
      const sub = after.children[1] as SplitNode;
      expect(sub.type).toBe('split');
      expect(sub.dir).toBe('col');
      expect(collectLeaves(sub).map((n) => n.id)).toEqual(['c', 'a']);
      expect(Math.abs(sub.ratios.reduce((x, y) => x + y, 0) - 1)).toBeLessThan(1e-9);
    });
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

  it('keeps a string scrollback but drops an oversized or non-string one', () => {
    expect(normalizeSession({ v: 1, root: L('a'), leaves: { a: { scrollback: 'hi\x1b[0m' } } }).leaves.a).toEqual({
      scrollback: 'hi\x1b[0m',
    });
    // Over the 1,000,000-char cap → dropped whole (never sliced mid-escape-sequence).
    expect(normalizeSession({ v: 1, root: L('a'), leaves: { a: { scrollback: 'x'.repeat(1_000_001) } } }).leaves.a).toEqual(
      {},
    );
    expect(normalizeSession({ v: 1, root: L('a'), leaves: { a: { scrollback: 123 } } }).leaves.a).toEqual({});
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
