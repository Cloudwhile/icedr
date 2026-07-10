import { HttpException, HttpStatus } from '@nestjs/common';

export type ObjectByteRange = {
  end: number;
  length: number;
  start: number;
};

export class RangeNotSatisfiableException extends HttpException {
  readonly contentRange: string;

  constructor(sizeBytes: number) {
    super(
      'Requested range is not satisfiable',
      HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE,
    );
    this.contentRange = `bytes */${sizeBytes}`;
  }
}

export function resolveObjectByteRange(
  rangeHeader: string | undefined,
  sizeBytes: number,
): ObjectByteRange | null {
  if (!rangeHeader?.trim()) return null;
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new RangeNotSatisfiableException(Math.max(0, sizeBytes));
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || rangeHeader.includes(',')) {
    throw new RangeNotSatisfiableException(sizeBytes);
  }

  const [, startValue, endValue] = match;
  if (!startValue && !endValue) {
    throw new RangeNotSatisfiableException(sizeBytes);
  }

  if (!startValue) {
    const suffixLength = parseRangeInteger(endValue, sizeBytes);
    if (suffixLength <= 0 || sizeBytes === 0) {
      throw new RangeNotSatisfiableException(sizeBytes);
    }
    const length = Math.min(suffixLength, sizeBytes);
    return {
      end: sizeBytes - 1,
      length,
      start: sizeBytes - length,
    };
  }

  const start = parseRangeInteger(startValue, sizeBytes);
  if (start >= sizeBytes) {
    throw new RangeNotSatisfiableException(sizeBytes);
  }
  const end = endValue
    ? Math.min(parseRangeInteger(endValue, sizeBytes), sizeBytes - 1)
    : sizeBytes - 1;
  if (end < start) {
    throw new RangeNotSatisfiableException(sizeBytes);
  }

  return {
    end,
    length: end - start + 1,
    start,
  };
}

function parseRangeInteger(value: string, sizeBytes: number) {
  if (!/^\d+$/.test(value)) {
    throw new RangeNotSatisfiableException(sizeBytes);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeNotSatisfiableException(sizeBytes);
  }
  return parsed;
}
