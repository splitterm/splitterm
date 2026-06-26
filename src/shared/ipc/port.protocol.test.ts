import { describe, it, expect } from 'vitest';
import { parseRendererToHost, parseHostToRenderer } from './port.protocol';
import { asTermId } from '../ids';

const id = asTermId(1);

describe('parseRendererToHost', () => {
  it('accepts valid write / resize / ack', () => {
    expect(parseRendererToHost({ t: 'write', id: 1, data: 'ls\r' })).toEqual({ t: 'write', id, data: 'ls\r' });
    expect(parseRendererToHost({ t: 'resize', id: 1, cols: 80, rows: 24 })).toEqual({ t: 'resize', id, cols: 80, rows: 24 });
    expect(parseRendererToHost({ t: 'ack', id: 1, bytes: 100 })).toEqual({ t: 'ack', id, bytes: 100 });
  });

  it.each([
    null,
    undefined,
    42,
    'str',
    [],
    {},
    { t: 'write' }, // missing id + data
    { t: 'write', id: 1 }, // missing data
    { t: 'write', id: '1', data: 'x' }, // id not a number
    { t: 'write', id: 1, data: 5 }, // data not a string
    { t: 'resize', id: 1, cols: '80', rows: 24 }, // cols not a number
    { t: 'ack', id: 1, bytes: 'x' }, // bytes not a number
    { t: 'unknown', id: 1 }, // unknown tag
    { id: 1, data: 'x' }, // no tag
  ])('rejects malformed %p', (input) => {
    expect(parseRendererToHost(input)).toBeNull();
  });

  it('keeps only the known shape (drops unknown fields)', () => {
    expect(parseRendererToHost({ t: 'write', id: 1, data: 'x', evil: 'rm -rf' })).toEqual({ t: 'write', id, data: 'x' });
  });
});

describe('parseHostToRenderer', () => {
  it('accepts valid data / exit', () => {
    expect(parseHostToRenderer({ t: 'data', id: 1, data: 'out' })).toEqual({ t: 'data', id, data: 'out' });
    expect(parseHostToRenderer({ t: 'exit', id: 1, code: 0 })).toEqual({ t: 'exit', id, code: 0 });
    expect(parseHostToRenderer({ t: 'exit', id: 1, code: 1, signal: 9 })).toEqual({ t: 'exit', id, code: 1, signal: 9 });
  });

  it('omits a non-number signal', () => {
    expect(parseHostToRenderer({ t: 'exit', id: 1, code: 1, signal: 'x' })).toEqual({ t: 'exit', id, code: 1 });
  });

  it.each([
    null,
    42,
    {},
    { t: 'data', id: 1 }, // missing data
    { t: 'data', id: 1, data: 5 }, // data not a string
    { t: 'exit', id: 1 }, // missing code
    { t: 'exit', id: 1, code: 'x' }, // code not a number
    { t: 'exit', id: '1', code: 0 }, // id not a number
    { t: 'unknown', id: 1 }, // unknown tag
  ])('rejects malformed %p', (input) => {
    expect(parseHostToRenderer(input)).toBeNull();
  });
});
