import { describe, it, expect } from 'vitest';
import { resolveStatus, DEFAULT_STATUS_COLORS, type GlobalStatus } from './status-appearance';

const noGlobal: GlobalStatus = {
  statusColors: { working: '', claudeWorking: '', attention: '', exited: '' },
  statusAnimations: { working: '', claudeWorking: '', attention: '', exited: '' },
};

describe('resolveStatus', () => {
  it('uses the built-in default when nothing overrides', () => {
    const r = resolveStatus('working', undefined, noGlobal);
    expect(r).toEqual({ enabled: true, color: DEFAULT_STATUS_COLORS.working, animated: true }); // working pulses by default
  });

  it('attention/exited are static by default', () => {
    expect(resolveStatus('attention', undefined, noGlobal).animated).toBe(false);
    expect(resolveStatus('exited', undefined, noGlobal).animated).toBe(false);
  });

  it('the global setting overrides the built-in', () => {
    const g: GlobalStatus = { statusColors: { ...noGlobal.statusColors, working: '#111111' }, statusAnimations: { ...noGlobal.statusAnimations, working: 'static' } };
    const r = resolveStatus('working', undefined, g);
    expect(r.color).toBe('#111111');
    expect(r.animated).toBe(false);
  });

  it('the profile override wins over global + built-in, and enabled defaults true', () => {
    const g: GlobalStatus = { statusColors: { ...noGlobal.statusColors, working: '#111111' }, statusAnimations: noGlobal.statusAnimations };
    const r = resolveStatus('working', { colors: { working: '#222222' }, animations: { working: 'static' } }, g);
    expect(r).toEqual({ enabled: true, color: '#222222', animated: false });
  });

  it('respects enabled:false', () => {
    expect(resolveStatus('working', { enabled: false }, noGlobal).enabled).toBe(false);
  });
});
