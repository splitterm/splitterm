import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import { spawnPty, rebindFirehose, killAll } from './pty-manager';
import { asTermId } from '../shared/ids';
import type { PortLike, HostToRenderer, SpawnRequest } from '../shared/ipc';

// node-pty hosts the native binding; mock it so tests never load it.
const spawnImpl = vi.hoisted(() => vi.fn());
vi.mock('node-pty', () => ({ spawn: (...args: unknown[]) => spawnImpl(...args) }));

// Note: the spawn-failure → synthetic-exit path (a bad shell path throws synchronously) is handled
// by spawnPty's try/catch but isn't unit-tested here — vitest surfaces a value thrown by a mocked
// module export as a test failure even when the code under test catches it, so a "spawn throws" mock
// can't be asserted cleanly. The cwd-validation tests below cover the other half of the guard.

function captor(): { port: PortLike; messages: HostToRenderer[] } {
  const messages: HostToRenderer[] = [];
  return { port: { postMessage: (m) => messages.push(m as HostToRenderer) }, messages };
}

function fakePty() {
  return {
    onData: vi.fn(),
    onExit: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  };
}

const REQ: SpawnRequest = { cols: 80, rows: 24 };
const SHELL = { file: 'bash', args: [] };
const spawnedOpts = (): { cwd: string } | undefined => spawnImpl.mock.calls[0]?.[2] as { cwd: string } | undefined;

describe('spawnPty', () => {
  beforeEach(() => {
    spawnImpl.mockReset();
    killAll(); // clear any sessions leaked from a previous test
  });

  it('wires data + exit handlers and emits nothing synthetic on a successful spawn', () => {
    const pty = fakePty();
    spawnImpl.mockReturnValue(pty);
    const { port, messages } = captor();
    rebindFirehose(port);

    spawnPty(asTermId(2), REQ, SHELL);

    expect(spawnImpl).toHaveBeenCalledOnce();
    expect(pty.onData).toHaveBeenCalledOnce();
    expect(pty.onExit).toHaveBeenCalledOnce();
    expect(messages).toHaveLength(0);
  });

  it('falls back to the home dir when the requested cwd does not exist', () => {
    spawnImpl.mockReturnValue(fakePty());
    rebindFirehose(captor().port);
    spawnPty(asTermId(3), { ...REQ, cwd: '/no/such/dir/exists' }, SHELL);
    expect(spawnedOpts()?.cwd).toBe(os.homedir());
  });

  it('passes a valid existing cwd through to node-pty', () => {
    spawnImpl.mockReturnValue(fakePty());
    rebindFirehose(captor().port);
    const valid = os.tmpdir();
    spawnPty(asTermId(4), { ...REQ, cwd: valid }, SHELL);
    expect(spawnedOpts()?.cwd).toBe(valid);
  });
});

describe('rebindFirehose', () => {
  beforeEach(() => {
    spawnImpl.mockReset();
    killAll();
  });

  it('kills sessions orphaned by a renderer reload when a new port connects', () => {
    const pty = fakePty();
    spawnImpl.mockReturnValue(pty);
    rebindFirehose(captor().port); // first page connects
    spawnPty(asTermId(10), REQ, SHELL);
    expect(pty.kill).not.toHaveBeenCalled();

    rebindFirehose(captor().port); // a reload connects a *new* port → the orphan is killed
    expect(pty.kill).toHaveBeenCalledOnce();
  });

  it('does not kill sessions when the same port reconnects', () => {
    const pty = fakePty();
    spawnImpl.mockReturnValue(pty);
    const { port } = captor();
    rebindFirehose(port);
    spawnPty(asTermId(11), REQ, SHELL);
    rebindFirehose(port); // same port object → not a reload
    expect(pty.kill).not.toHaveBeenCalled();
  });
});
