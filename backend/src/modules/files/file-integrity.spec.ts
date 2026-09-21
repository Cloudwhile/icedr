import {
  needsFileIntegrityVerification,
  normalizeFileIntegrityFailureCode,
  normalizeFileIntegrityStatus,
} from './file-integrity';

describe('file integrity metadata normalization', () => {
  it('fails closed when persisted metadata contains unknown values', () => {
    expect(normalizeFileIntegrityStatus('database-garbage')).toBe('unknown');
    expect(normalizeFileIntegrityFailureCode('internal-secret')).toBeNull();
  });

  it('preserves supported integrity values', () => {
    expect(normalizeFileIntegrityStatus('mismatch')).toBe('mismatch');
    expect(normalizeFileIntegrityFailureCode('checksum-mismatch')).toBe(
      'checksum-mismatch',
    );
  });

  it('requires verification for copied or archived content without a settled checksum', () => {
    expect(
      needsFileIntegrityVerification({
        checksumAlgorithm: null,
        checksumValue: null,
        integrityStatus: 'pending',
      }),
    ).toBe(true);
    expect(
      needsFileIntegrityVerification({
        checksumAlgorithm: 'sha256',
        checksumValue: 'a'.repeat(64),
        integrityStatus: 'verified',
      }),
    ).toBe(false);
    expect(
      needsFileIntegrityVerification({
        checksumAlgorithm: null,
        checksumValue: 'a'.repeat(64),
        integrityStatus: 'verified',
      }),
    ).toBe(true);
  });
});
