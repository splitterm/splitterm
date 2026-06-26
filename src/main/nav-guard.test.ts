import { describe, it, expect } from 'vitest';
import { isAllowedNavigation } from './nav-guard';

const APP = 'file:///C:/app/renderer/main_window/index.html';
const DEV = 'http://localhost:5173';

describe('isAllowedNavigation', () => {
  describe('dev (origin-pinned)', () => {
    it('allows the same dev origin', () =>
      expect(isAllowedNavigation('http://localhost:5173/index.html', DEV, APP)).toBe(true));
    it('allows the dev origin with hash/query (HMR)', () =>
      expect(isAllowedNavigation('http://localhost:5173/#/x?y=1', DEV, APP)).toBe(true));
    it('blocks a different origin', () =>
      expect(isAllowedNavigation('https://evil.example/', DEV, APP)).toBe(false));
    it('blocks file URLs while in dev', () =>
      expect(isAllowedNavigation('file:///etc/passwd', DEV, APP)).toBe(false));
  });

  describe('prod (file-pinned)', () => {
    it('allows exactly the app index.html', () => expect(isAllowedNavigation(APP, null, APP)).toBe(true));
    it('allows the app page with a hash route', () =>
      expect(isAllowedNavigation(`${APP}#/settings`, null, APP)).toBe(true));
    it('allows the app page with a query string', () =>
      expect(isAllowedNavigation(`${APP}?x=1`, null, APP)).toBe(true));

    // The reported security bug: a bare `protocol === 'file:'` check let these through.
    it('blocks any OTHER local file', () => {
      expect(isAllowedNavigation('file:///C:/Temp/attacker.html', null, APP)).toBe(false);
      expect(isAllowedNavigation('file:///etc/passwd', null, APP)).toBe(false);
      expect(isAllowedNavigation('file:///C:/app/renderer/main_window/evil.html', null, APP)).toBe(false);
    });
    it('blocks remote origins', () => expect(isAllowedNavigation('https://evil.example/', null, APP)).toBe(false));
  });

  it('fails closed on an unparseable URL', () => {
    expect(isAllowedNavigation('not a url', DEV, APP)).toBe(false);
    expect(isAllowedNavigation('', null, APP)).toBe(false);
  });
});
