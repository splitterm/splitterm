import { describe, it, expect } from 'vitest';
import { asTermId } from '../ids';
import { leaf, splitLeaf, closeLeaf, collectLeaves, findLeaf, type SplitNode } from './layout-tree';

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
