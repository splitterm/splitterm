import { describe, it, expect } from 'vitest';
import { asTermId, asPaneId, asWindowId } from './ids';

describe('branded ids', () => {
  it('preserve the underlying primitive value at runtime', () => {
    expect(asTermId(7)).toBe(7);
    expect(asPaneId('pane-1')).toBe('pane-1');
    expect(asWindowId(0)).toBe(0);
  });
});
