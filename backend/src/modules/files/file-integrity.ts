import type {
  FileIntegrityFailureCode,
  FileIntegrityStatus,
} from './file-nodes.dto';

const statuses = new Set<FileIntegrityStatus>([
  'unknown',
  'pending',
  'verified',
  'mismatch',
  'failed',
]);

const failureCodes = new Set<FileIntegrityFailureCode>([
  'missing-object',
  'size-mismatch',
  'checksum-mismatch',
  'verification-failed',
]);

export function normalizeFileIntegrityStatus(
  value: string,
): FileIntegrityStatus {
  return statuses.has(value as FileIntegrityStatus)
    ? (value as FileIntegrityStatus)
    : 'unknown';
}

export function normalizeFileIntegrityFailureCode(
  value: string | null,
): FileIntegrityFailureCode | null {
  return value && failureCodes.has(value as FileIntegrityFailureCode)
    ? (value as FileIntegrityFailureCode)
    : null;
}

export function needsFileIntegrityVerification(input: {
  checksumAlgorithm: string | null;
  checksumValue: string | null;
  integrityStatus: string;
}) {
  const algorithm = input.checksumAlgorithm
    ?.trim()
    .toLowerCase()
    .replace('-', '');
  const hasValidBaseline =
    algorithm === 'sha256' &&
    /^[a-f0-9]{64}$/i.test(input.checksumValue?.trim() ?? '');
  return (
    !hasValidBaseline ||
    input.integrityStatus === 'unknown' ||
    input.integrityStatus === 'pending'
  );
}
