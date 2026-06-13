import { randomBytes } from 'crypto';

const localPrefix = 'local';
const workspaceRoot = 'workspaces';
const spacesGroup = 'spaces';
const objectGroup = 'objects';
const originalObjectType = 'original';
const legacyUploadRoot = 'uploads';

export type FileObjectSpaceScope = 'workspace' | 'personal';

export type FileObjectKeyInput = {
  distributedStorage: boolean;
  fileName: string;
  now?: Date;
  nonce?: string;
  spaceScope?: FileObjectSpaceScope;
  workspaceId: string;
};

export type FileObjectKeyPayload = {
  fileName: string;
  objectKey: string;
  spaceScope?: FileObjectSpaceScope;
  workspaceId: string;
};

export function createFileObjectKey(input: FileObjectKeyInput) {
  const now = input.now ?? new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const key = [
    workspaceRoot,
    encodeObjectKeySegment(input.workspaceId),
    spacesGroup,
    normalizeSpaceScope(input.spaceScope),
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
  spaceScope,
  workspaceId,
}: FileObjectKeyPayload) {
  const parts = objectKey.split('/');
  const offset = parts[0] === localPrefix ? 1 : 0;
  const currentExpectedLength = offset + 10;
  const legacyExpectedLength = offset + 8;
  if (
    parts.length !== currentExpectedLength &&
    parts.length !== legacyExpectedLength
  ) {
    return false;
  }
  const hasSpaceScope = parts.length === currentExpectedLength;
  const objectOffset = hasSpaceScope ? offset + 2 : offset;
  if (
    parts[offset] !== workspaceRoot ||
    parts[offset + 1] !== encodeObjectKeySegment(workspaceId) ||
    (hasSpaceScope &&
      (parts[offset + 2] !== spacesGroup ||
        parts[offset + 3] !== normalizeSpaceScope(spaceScope))) ||
    parts[objectOffset + 2] !== objectGroup ||
    parts[objectOffset + 3] !== originalObjectType ||
    !/^\d{4}$/.test(parts[objectOffset + 4] ?? '') ||
    !/^(0[1-9]|1[0-2])$/.test(parts[objectOffset + 5] ?? '') ||
    !/^[A-Za-z0-9_-]{16}$/.test(parts[objectOffset + 6] ?? '') ||
    parts[objectOffset + 7] !== encodeObjectKeySegment(fileName)
  ) {
    return false;
  }
  if (!hasSpaceScope && normalizeSpaceScope(spaceScope) !== 'workspace') {
    return false;
  }
  return isSafeObjectKey(objectKey);
}

function isLegacyUploadObjectKeyForPayload({
  fileName,
  objectKey,
  spaceScope,
  workspaceId,
}: FileObjectKeyPayload) {
  if (normalizeSpaceScope(spaceScope) !== 'workspace') return false;
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

function normalizeSpaceScope(value?: string): FileObjectSpaceScope {
  return value === 'personal' ? 'personal' : 'workspace';
}
