import { HttpStatus } from '@nestjs/common';
import {
  RangeNotSatisfiableException,
  resolveObjectByteRange,
} from './object-byte-range';

describe('resolveObjectByteRange', () => {
  it.each([
    ['bytes=2-5', { end: 5, length: 4, start: 2 }],
    ['bytes=7-', { end: 9, length: 3, start: 7 }],
    ['bytes=-4', { end: 9, length: 4, start: 6 }],
  ])('resolves %s against the object size', (header, expected) => {
    expect(resolveObjectByteRange(header, 10)).toEqual(expected);
  });

  it('returns null when the client did not request a range', () => {
    expect(resolveObjectByteRange(undefined, 10)).toBeNull();
  });

  it.each([
    'bytes=10-12',
    'bytes=7-2',
    'bytes=0-1,4-5',
    'items=0-1',
    'bytes=-0',
    'bytes=abc-def',
  ])('rejects an invalid or unsupported range: %s', (header) => {
    expect(() => resolveObjectByteRange(header, 10)).toThrow(
      RangeNotSatisfiableException,
    );

    try {
      resolveObjectByteRange(header, 10);
    } catch (error) {
      expect(error).toBeInstanceOf(RangeNotSatisfiableException);
      expect((error as RangeNotSatisfiableException).getStatus()).toBe(
        HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
      );
      expect((error as RangeNotSatisfiableException).contentRange).toBe(
        'bytes */10',
      );
    }
  });
});
