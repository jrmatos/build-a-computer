import { describe, expect, it } from 'vitest';
import { formatValue, groupDigits, parseNumber, probeText, stepValue, toSigned } from './numberFormat';

describe('parseNumber', () => {
  it('reads hex, binary and decimal', () => {
    expect(parseNumber('0x1F', 8)).toBe(31);
    expect(parseNumber('1fh', 8)).toBe(31);
    expect(parseNumber('$ff', 8)).toBe(255);
    expect(parseNumber('0b1010', 4)).toBe(10);
    expect(parseNumber('42', 8)).toBe(42);
    expect(parseNumber(' 1_000 ', 16)).toBe(1000);
  });
  it('reads negatives as two’s complement', () => {
    expect(parseNumber('-1', 8)).toBe(255);
    expect(parseNumber('-128', 8)).toBe(128);
    expect(parseNumber('-129', 8)).toBeNull();
    expect(parseNumber('-1', 32)).toBe(0xffffffff);
  });
  it('rejects junk and values that do not fit', () => {
    expect(parseNumber('', 8)).toBeNull();
    expect(parseNumber('12z', 8)).toBeNull();
    expect(parseNumber('256', 8)).toBeNull();
    expect(parseNumber('0x100', 8)).toBeNull();
    expect(parseNumber('0xFFFFFFFF', 32)).toBe(0xffffffff);
  });
});

describe('formatting', () => {
  it('signed reading', () => {
    expect(toSigned(0xff, 8)).toBe(-1);
    expect(toSigned(0x7f, 8)).toBe(127);
    expect(toSigned(0xffffffff, 32)).toBe(-1);
    expect(toSigned(1, 1)).toBe(-1);
  });
  it('formats by base', () => {
    expect(formatValue(10, 8, 'hex')).toBe('0x0A');
    expect(formatValue(5, 4, 'bin')).toBe('0b0101');
    expect(formatValue(0xfe, 8, 'signed')).toBe('-2');
    expect(groupDigits('101100111')).toBe('1 0110 0111');
  });
  it('steps with wraparound', () => {
    expect(stepValue(255, 1, 8)).toBe(0);
    expect(stepValue(0, -1, 8)).toBe(255);
    expect(stepValue(0xffffffff, 1, 32)).toBe(0);
  });
});

describe('probeText', () => {
  it('shows binary, decimal, signed and hex', () => {
    expect(probeText(8, 0xfe, 0)).toEqual({ width: 8, bin: '1111 1110', dec: '254', signed: '-2', hex: 'FE', xBits: 0 });
  });
  it('marks unknown bits', () => {
    const p = probeText(8, 0x0f, 0x30);
    expect(p.bin).toBe('00xx 1111');
    expect(p.hex).toBe('XF');
    expect(p.dec).toBeNull();
    expect(p.xBits).toBe(2);
  });
  it('handles 32-bit values', () => {
    expect(probeText(32, 0xdeadbeef, 0).hex).toBe('DEADBEEF');
    expect(probeText(32, 0xffffffff, 0).signed).toBe('-1');
  });
});
