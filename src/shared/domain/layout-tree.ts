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
  leaves: Record<string, { cwd?: string; profileId?: string; title?: string }>;
}

export const EMPTY_SESSION: SessionV1 = { v: 1, root: null, focusedLeafId: null, maximizedId: null, leaves: {} };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

// A generous ceiling on restored panes: a real layout never approaches it, but it stops a crafted
// session.json from making the next launch spawn thousands of shells.
const MAX_LEAVES = 100;

// Coerce one persisted node. Returns null for anything malformed so the caller can drop the tree.
// `seen` enforces unique leaf ids (duplicates would corrupt focus/close bookkeeping) and, via its
// size, the leaf cap.
function normalizeNode(n: unknown, seen: Set<string>): LayoutNode | null {
  if (!isObj(n)) return null;
  if (n.type === 'leaf') {
    if (typeof n.id !== 'string' || !n.id) return null;
    if (seen.has(n.id) || seen.size >= MAX_LEAVES) return null; // duplicate id or too many panes
    seen.add(n.id);
    // termId is session-specific (the old pty is gone); keep a number but restore re-spawns anyway.
    return { type: 'leaf', id: n.id, termId: (typeof n.termId === 'number' ? n.termId : 0) as TermId };
  }
  if (n.type === 'split') {
    if (n.dir !== 'row' && n.dir !== 'col') return null;
    if (!Array.isArray(n.children) || n.children.length < 2) return null;
    const children: LayoutNode[] = [];
    for (const c of n.children) {
      const nc = normalizeNode(c, seen);
      if (!nc) return null; // any malformed child invalidates the whole split
      children.push(nc);
    }
    // Ratios: positive finite numbers, one per child, renormalized to sum 1; else even split.
    const raw = Array.isArray(n.ratios) ? n.ratios : [];
    let ratios = raw.filter((r): r is number => typeof r === 'number' && Number.isFinite(r) && r > 0);
    if (ratios.length !== children.length) ratios = children.map(() => 1 / children.length);
    const sum = ratios.reduce((a, b) => a + b, 0);
    ratios = ratios.map((r) => r / sum);
    return { type: 'split', dir: n.dir, children, ratios };
  }
  return null;
}

/**
 * The trust boundary for session.json (untrusted file input). Coerces the persisted blob onto
 * SessionV1, dropping the whole tree if the structure is malformed, has duplicate/too-many leaves,
 * etc. (a partial/oversized layout is riskier than none). Never throws; always returns a valid
 * SessionV1.
 */
export function normalizeSession(input: unknown): SessionV1 {
  if (!isObj(input) || input.v !== 1) return EMPTY_SESSION;
  const root = input.root == null ? null : normalizeNode(input.root, new Set());
  if (input.root != null && root === null) return EMPTY_SESSION; // present but malformed → drop all

  // Null-prototype map so an untrusted "__proto__" leaf key becomes a plain own property instead of
  // reparenting the object (which would silently drop that leaf's metadata on the next save).
  const leaves: SessionV1['leaves'] = Object.create(null) as SessionV1['leaves'];
  if (isObj(input.leaves)) {
    for (const [k, v] of Object.entries(input.leaves)) {
      if (!isObj(v)) continue;
      const entry: SessionV1['leaves'][string] = {};
      if (typeof v.cwd === 'string') entry.cwd = v.cwd.slice(0, 4096);
      if (typeof v.profileId === 'string') entry.profileId = v.profileId.slice(0, 200);
      if (typeof v.title === 'string') entry.title = v.title.slice(0, 500);
      leaves[k] = entry;
    }
  }
  return {
    v: 1,
    root,
    focusedLeafId: typeof input.focusedLeafId === 'string' ? input.focusedLeafId : null,
    maximizedId: typeof input.maximizedId === 'string' ? input.maximizedId : null,
    leaves,
  };
}
