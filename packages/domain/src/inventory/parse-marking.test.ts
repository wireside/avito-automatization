import { describe, expect, it } from 'vitest';
import { parseClothingMarking } from './parse-marking.js';
const raw =
  '010466043076454321TEST000000001\u001d91ABCD\u001d92' + 'A'.repeat(44);
describe('clothing marking parser', () => {
  it('preserves identity across known transport decoration', () => {
    const camera = parseClothingMarking(raw, 'camera-gs1-v1');
    expect(camera.ok).toBe(true);
    expect(parseClothingMarking('\u001d' + raw, 'camera-gs1-v1')).toEqual(
      camera,
    );
    expect(
      parseClothingMarking(']d2' + raw + '\r\n', 'keyboard-gs1-v1'),
    ).toEqual(camera);
    expect(camera.ok && camera.marking.gtin).toBe('04660430764543');
  });
  it('retains serial case and punctuation', () => {
    const parsed = parseClothingMarking(
      raw.replace('TEST000000001', 'tEst!_"/9?XY'),
      'camera-gs1-v1',
    );
    // The example has twelve symbols: truncated serials must be refused.
    expect(parsed.ok).toBe(false);
    const valid = parseClothingMarking(
      raw.replace('TEST000000001', 'tEst!_"/9?XYZ'),
      'camera-gs1-v1',
    );
    expect(valid.ok && valid.marking.serial).toBe('tEst!_"/9?XYZ');
  });
  it.each([
    raw.replaceAll('\u001d', ''),
    ' ' + raw,
    raw + ' ',
    raw + '\n',
    raw.slice(0, -1),
    '(01)04660430764543(21)TEST000000001',
  ])('refuses lossy or unsupported input', (value) => {
    expect(parseClothingMarking(value, 'camera-gs1-v1').ok).toBe(false);
  });
  it('checks GTIN checksum', () => {
    expect(
      parseClothingMarking(
        raw.replace('04660430764543', '04660430764544'),
        'camera-gs1-v1',
      ),
    ).toEqual({ ok: false, code: 'INVALID_GTIN' });
  });
});
