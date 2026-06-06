// The BSP tiling tree — plain JSON-serializable data + PURE transforms (Vitest-tested, no DOM).
// n-ary splits keep the tree shallow: splitting into a same-direction parent splices a sibling
// instead of nesting. The renderer (features/tiling) consumes these and never mutates structure
// except through them.
import type { TermId } from '../ids';

export type Dir = 'row' | 'col';

export interface LeafNode {
  type: 'leaf';
  id: string;
  termId: TermId;
}

export interface SplitNode {
  type: 'split';
  dir: Dir;
  children: LayoutNode[];
  ratios: number[];
}

export type LayoutNode = LeafNode | SplitNode;

export function leaf(id: string, termId: TermId): LeafNode {
  return { type: 'leaf', id, termId };
}

export function collectLeaves(node: LayoutNode): LeafNode[] {
  return node.type === 'leaf' ? [node] : node.children.flatMap(collectLeaves);
}

export function findLeaf(node: LayoutNode, id: string): LeafNode | null {
  if (node.type === 'leaf') return node.id === id ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, id);
    if (found) return found;
  }
  return null;
}

function normalize(ratios: number[]): number[] {
  const sum = ratios.reduce((a, b) => a + b, 0);
  if (sum <= 0) return ratios.map(() => 1 / ratios.length);
  return ratios.map((r) => r / sum);
}

/**
 * Split `targetId` in direction `dir`, inserting `newLeaf` next to it. If the target's parent is
 * already a split of the same direction, the new leaf is spliced in as a sibling (no extra
 * nesting); otherwise the leaf is replaced by a 2-child sub-split. Returns a new tree.
 */
export function splitLeaf(node: LayoutNode, targetId: string, dir: Dir, newLeaf: LeafNode): LayoutNode {
  if (node.type === 'leaf') {
    if (node.id !== targetId) return node;
    return { type: 'split', dir, children: [node, newLeaf], ratios: [0.5, 0.5] };
  }

  const idx = node.children.findIndex((c) => c.type === 'leaf' && c.id === targetId);
  if (idx >= 0) {
    const target = node.children[idx]!;
    if (node.dir === dir) {
      const children = [...node.children];
      children.splice(idx + 1, 0, newLeaf);
      // Equalize siblings so panes stay gleichmäßig (no progressive shrinking).
      const ratios = new Array<number>(children.length).fill(1 / children.length);
      return { ...node, children, ratios };
    }
    const children = [...node.children];
    children[idx] = { type: 'split', dir, children: [target, newLeaf], ratios: [0.5, 0.5] };
    return { ...node, children };
  }

  return { ...node, children: node.children.map((c) => splitLeaf(c, targetId, dir, newLeaf)) };
}

/**
 * Remove `targetId`, collapsing any split left with a single child into that child. Returns the
 * new tree, or null if the last leaf was removed.
 */
export function closeLeaf(node: LayoutNode, targetId: string): LayoutNode | null {
  if (node.type === 'leaf') return node.id === targetId ? null : node;

  const idx = node.children.findIndex((c) => c.type === 'leaf' && c.id === targetId);
  if (idx >= 0) {
    const children = node.children.filter((_, i) => i !== idx);
    if (children.length === 1) return children[0]!;
    const ratios = normalize(node.ratios.filter((_, i) => i !== idx));
    return { ...node, children, ratios };
  }

  // Target is nested deeper; recurse. It is a direct child of exactly one split, handled above,
  // so recursion never returns null here.
  return { ...node, children: node.children.map((c) => closeLeaf(c, targetId) as LayoutNode) };
}

/** Serialized session (written to userData/session.json by main; restored on launch). */
export interface SessionV1 {
  v: 1;
  root: LayoutNode | null;
  focusedLeafId: string | null;
  maximizedId: string | null;
  leaves: Record<string, { cwd?: string; profileId?: string }>;
}
