import { randomBytes } from 'crypto';

const localPrefix = 'local';
const workspaceRoot = 'workspaces';
const objectGroup = 'objects';
const originalObjectType = 'original';
const legacyUploadRoot = 'uploads';

export type FileObjectKeyInput = {
  distributedStorage: boolean;
  fileName: string;
  now?: Date;
  nonce?: string;
  workspaceId: string;
};

export type FileObjectKeyPayload = {
  fileName: string;
  objectKey: string;
  workspaceId: string;
};

export function createFileObjectKey(input: FileObjectKeyInput) {
  const now = input.now ?? new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const key = [
    workspaceRoot,
    encodeObjectKeySegment(input.workspaceId),
    objectGroup,
    originalObjectType,
    year,
    month,
    input.nonce ?? randomBytes(12).toString('base64url'),
    encodeObjectKeySegment(input.fileName),
  ].join('/');

  return input.distributedStorage ? key : `${localPrefix}/${key}`;
}

export function getWorkspaceObjectPrefixes(input: {
  distributedStorage: boolean;
  workspaceId: string;
}) {
  const encodedWorkspace = encodeObjectKeySegment(input.workspaceId);
  const current = input.distributedStorage
    ? `${workspaceRoot}/${encodedWorkspace}/`
    : `${localPrefix}/${workspaceRoot}/${encodedWorkspace}/`;
  const legacy = input.distributedStorage
    ? `${legacyUploadRoot}/${encodedWorkspace}/`
    : `${localPrefix}/${legacyUploadRoot}/${encodedWorkspace}/`;
  return [current, legacy];
}

export function isLocalObjectKey(key: string) {
  return key.startsWith(`${localPrefix}/`) && isSafeObjectKey(key);
}

export function isUploadObjectKeyForPayload(input: FileObjectKeyPayload) {
  return (
    isCurrentFileObjectKeyForPayload(input) ||
    isLegacyUploadObjectKeyForPayload(input)
  );
}

function isCurrentFileObjectKeyForPayload({
  fileName,
  objectKey,
  workspaceId,
}: FileObjectKeyPayload) {
  const parts = objectKey.split('/');
  const offset = parts[0] === localPrefix ? 1 : 0;
  const expectedLength = offset + 8;
  if (parts.length !== expectedLength) return false;
  if (
    parts[offset] !== workspaceRoot ||
    parts[offset + 1] !== encodeObjectKeySegment(workspaceId) ||
    parts[offset + 2] !== objectGroup ||
    parts[offset + 3] !== originalObjectType ||
    !/^\d{4}$/.test(parts[offset + 4] ?? '') ||
    !/^(0[1-9]|1[0-2])$/.test(parts[offset + 5] ?? '') ||
    !/^[A-Za-z0-9_-]{16}$/.test(parts[offset + 6] ?? '') ||
    parts[offset + 7] !== encodeObjectKeySegment(fileName)
  ) {
    return false;
  }
  return isSafeObjectKey(objectKey);
}

function isLegacyUploadObjectKeyForPayload({
  fileName,
  objectKey,
  workspaceId,
}: FileObjectKeyPayload) {
  const parts = objectKey.split('/');
  const offset = parts[0] === localPrefix ? 1 : 0;
  if (parts.length !== offset + 4) return false;
  if (
    parts[offset] !== legacyUploadRoot ||
    parts[offset + 1] !== encodeObjectKeySegment(workspaceId) ||
    !/^\d{10,}-[A-Za-z0-9_-]{16}-.+$/.test(parts[offset + 3] ?? '') ||
    !parts[offset + 3]?.endsWith(`-${encodeObjectKeySegment(fileName)}`)
  ) {
    return false;
  }
  return isSafeObjectKey(objectKey);
}

function isSafeObjectKey(key: string) {
  return (
    !key.includes('\\') &&
    !key.split('/').some((part) => part === '..' || part === '')
  );
}

function encodeObjectKeySegment(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return encodeURIComponent(trimmed);
}
