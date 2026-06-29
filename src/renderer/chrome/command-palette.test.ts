import { describe, it, expect } from 'vitest';
import { filterCommands, type Command } from './command-palette';

const cmd = (id: string, title: string): Command => ({ id, title, run: () => {} });

describe('filterCommands', () => {
  const cmds = [cmd('a', 'Split right'), cmd('b', 'Split down'), cmd('c', 'Close pane'), cmd('d', 'Focus left')];

  it('returns everything (unchanged order) for an empty/blank query', () => {
    expect(filterCommands('', cmds)).toEqual(cmds);
    expect(filterCommands('   ', cmds)).toEqual(cmds);
  });

  it('substring-matches case-insensitively', () => {
    expect(filterCommands('split', cmds).map((c) => c.id)).toEqual(['a', 'b']);
    expect(filterCommands('PANE', cmds).map((c) => c.id)).toEqual(['c']);
  });

  it('ranks prefix matches above mid-string matches', () => {
    const xs = [cmd('a', 'Toggle zoom'), cmd('b', 'Zoom in')];
    expect(filterCommands('zoom', xs).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('preserves original order within the same tier (stable)', () => {
    const xs = [cmd('a', 'Focus'), cmd('b', 'Zoom'), cmd('c', 'Close')]; // 'o' is mid-string in all three
    expect(filterCommands('o', xs).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops non-matches', () => {
    expect(filterCommands('xyz', cmds)).toEqual([]);
  });
});
