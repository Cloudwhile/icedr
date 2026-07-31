import type {
  DriveSpaceScope,
  TransferTaskFailureCode,
  TransferTaskStatus,
} from "@/lib/drive-api";
import { validateDriveFileName } from "./file-name-policy";
import { IncrementalSha256 } from "./incremental-sha256";

const uploadRecoveryStorageKey = "icedr.upload.recovery.v2";
const uploadRecoveryVersion = 2 as const;
const maxRecoveryRecords = 128;
const fingerprintChunkBytes = 1024 * 1024;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const resumeIdentityPattern = /^drive-upload-v2:[a-f0-9]{64}$/;
const uploadRecoveryDescriptorKeys = new Set([
  "batchId",
  "conflictStrategy",
  "contentFingerprint",
  "expiresAt",
  "failureCode",
  "fileLastModified",
  "fileName",
  "fileSize",
  "mimeType",
  "ownerUserId",
  "parentNodeId",
  "progress",
  "resumeIdentity",
  "sessionId",
  "spaceScope",
  "status",
  "transferId",
  "updatedAt",
  "uploadedBytes",
  "version",
  "workspaceId",
]);
const uploadRecoveryEnvelopeKeys = new Set(["records", "version"]);

const transferStatuses = new Set<TransferTaskStatus>([
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "expired",
  "canceled",
]);

const transferFailureCodes = new Set<TransferTaskFailureCode>([
  "TRANSFER_FAILED",
  "TRANSFER_EXPIRED",
  "TRANSFER_STALLED",
  "UPLOAD_FAILED",
  "UPLOAD_SESSION_EXPIRED",
  "DOWNLOAD_INTENT_EXPIRED",
  "DOWNLOAD_FAILED",
  "PREVIEW_UNSUPPORTED",
  "PREVIEW_TOO_LARGE",
  "STORAGE_RECONCILE_FAILED",
]);

export type UploadRecoveryConflictStrategy =
  | "overwrite"
  | "rename"
  | "skip"
  | "version";

export type UploadResumeIdentityV2 = {
  contentFingerprint: string;
  resumeIdentity: string;
};

export type UploadRecoveryFileMetadata = {
  contentFingerprint: string;
  fileLastModified: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

export type UploadRecoveryDescriptor = UploadRecoveryFileMetadata & {
  batchId: string;
  conflictStrategy: UploadRecoveryConflictStrategy;
  expiresAt: string;
  failureCode: TransferTaskFailureCode | null;
  ownerUserId: string;
  parentNodeId: string | null;
  progress: number;
  resumeIdentity: string;
  sessionId: string;
  spaceScope: DriveSpaceScope;
  status: TransferTaskStatus;
  transferId: string;
  updatedAt: string;
  uploadedBytes: number;
  version: typeof uploadRecoveryVersion;
  workspaceId: string;
};

export type UploadRecoveryDescriptorInput = Omit<
  UploadRecoveryDescriptor,
  "version"
>;

type UploadRecoveryStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

type UploadRecoveryEnvelope = {
  records: UploadRecoveryDescriptor[];
  version: typeof uploadRecoveryVersion;
};

export async function createUploadResumeIdentityV2({
  contentFingerprint,
  file,
  fileName,
  parentNodeId,
  spaceScope,
  workspaceId,
}: {
  contentFingerprint?: string;
  file: File;
  fileName?: string;
  parentNodeId?: string | null;
  spaceScope: DriveSpaceScope;
  workspaceId: string;
}): Promise<UploadResumeIdentityV2> {
  const resolvedFingerprint =
    contentFingerprint ?? (await createLightweightUploadFingerprint(file));
  if (!sha256Pattern.test(resolvedFingerprint)) {
    throw new Error("Upload content fingerprint is invalid");
  }
  const fileNameValidation = validateDriveFileName(fileName ?? file.name);
  if (!fileNameValidation.ok) {
    throw new Error("Upload file name is invalid");
  }
  const identityPayload = JSON.stringify({
    contentFingerprint: resolvedFingerprint,
    fileName: fileNameValidation.name,
    fileSize: normalizeNonNegativeInteger(file.size),
    mimeType: normalizeMimeType(file.type),
    parentNodeId: parentNodeId?.trim() || null,
    spaceScope,
    version: uploadRecoveryVersion,
    workspaceId,
  });
  const identityHash = await digestSha256(new TextEncoder().encode(identityPayload));
  return {
    contentFingerprint: resolvedFingerprint,
    resumeIdentity: `drive-upload-v2:${identityHash}`,
  };
}

export async function createLightweightUploadFingerprint(file: File) {
  const hasher = new IncrementalSha256();
  for (let start = 0; start < file.size; start += fingerprintChunkBytes) {
    const end = Math.min(file.size, start + fingerprintChunkBytes);
    hasher.update(new Uint8Array(await readBlob(file.slice(start, end))));
  }
  return `sha256:${toHex(hasher.digest())}`;
}

export function createUploadRecoveryDescriptor(
  input: UploadRecoveryDescriptorInput,
): UploadRecoveryDescriptor {
  const descriptor: UploadRecoveryDescriptor = {
    ...input,
    version: uploadRecoveryVersion,
  };
  if (!isUploadRecoveryDescriptor(descriptor)) {
    throw new Error("Upload recovery descriptor is invalid");
  }
  return projectUploadRecoveryDescriptor(descriptor);
}

export function readUploadRecoveryDescriptors(
  storage: UploadRecoveryStorage | null = getSessionStorage(),
) {
  if (!storage) return [];
  let raw: string | null;
  try {
    raw = storage.getItem(uploadRecoveryStorageKey);
  } catch {
    return [];
  }
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isUploadRecoveryEnvelope(parsed)) {
      removeRecoveryStorage(storage);
      return [];
    }
    return parsed.records;
  } catch {
    removeRecoveryStorage(storage);
    return [];
  }
}

export function saveUploadRecoveryDescriptor(
  descriptor: UploadRecoveryDescriptor,
  storage: UploadRecoveryStorage | null = getSessionStorage(),
) {
  if (!storage || !isUploadRecoveryDescriptor(descriptor)) return false;
  const safeDescriptor = projectUploadRecoveryDescriptor(descriptor);
  const records = readUploadRecoveryDescriptors(storage).filter(
    (record) => record.sessionId !== safeDescriptor.sessionId,
  );
  records.push(safeDescriptor);
  records.sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
  return writeRecoveryEnvelope(records.slice(0, maxRecoveryRecords), storage);
}

export function removeUploadRecoveryDescriptor(
  sessionId: string,
  storage: UploadRecoveryStorage | null = getSessionStorage(),
) {
  if (!storage || !isBoundedString(sessionId, 256)) return 0;
  return removeMatchingRecoveryDescriptors(
    (descriptor) => descriptor.sessionId === sessionId,
    storage,
  );
}

export function clearUploadRecoveryBatch(
  batchId: string,
  storage: UploadRecoveryStorage | null = getSessionStorage(),
) {
  if (!storage || !isBoundedString(batchId, 128)) return 0;
  return removeMatchingRecoveryDescriptors(
    (descriptor) => descriptor.batchId === batchId,
    storage,
  );
}

export function clearUploadRecoveryOwner(
  ownerUserId: string,
  storage: UploadRecoveryStorage | null = getSessionStorage(),
) {
  if (!storage || !isBoundedString(ownerUserId, 256)) return 0;
  return removeMatchingRecoveryDescriptors(
    (descriptor) => descriptor.ownerUserId === ownerUserId,
    storage,
  );
}

export function clearAllUploadRecoveryDescriptors(
  storage: UploadRecoveryStorage | null = getSessionStorage(),
) {
  if (!storage) return;
  removeRecoveryStorage(storage);
}

export function matchesUploadRecoveryFileMetadata(
  descriptor: UploadRecoveryFileMetadata,
  file: Pick<File, "lastModified" | "name" | "size" | "type">,
) {
  const fileNameValidation = validateDriveFileName(file.name);
  return (
    fileNameValidation.ok &&
    descriptor.fileName === fileNameValidation.name &&
    descriptor.fileSize === file.size &&
    descriptor.mimeType === normalizeMimeType(file.type)
  );
}

export function matchesUploadRecoveryIdentity(
  descriptor: Pick<
    UploadRecoveryDescriptor,
    "contentFingerprint" | "resumeIdentity"
  >,
  identity: UploadResumeIdentityV2,
) {
  return (
    descriptor.contentFingerprint === identity.contentFingerprint &&
    descriptor.resumeIdentity === identity.resumeIdentity
  );
}

export async function matchesUploadRecoveryFile(
  descriptor: UploadRecoveryDescriptor,
  file: File,
) {
  if (!matchesUploadRecoveryFileMetadata(descriptor, file)) return false;
  const identity = await createUploadResumeIdentityV2({
    file,
    parentNodeId: descriptor.parentNodeId,
    spaceScope: descriptor.spaceScope,
    workspaceId: descriptor.workspaceId,
  });
  return matchesUploadRecoveryIdentity(descriptor, identity);
}

export function isUploadRecoveryDescriptor(
  value: unknown,
): value is UploadRecoveryDescriptor {
  if (
    !isRecord(value) ||
    value.version !== uploadRecoveryVersion ||
    !hasExactKeys(value, uploadRecoveryDescriptorKeys)
  ) {
    return false;
  }
  return (
    isBoundedString(value.batchId, 128) &&
    isConflictStrategy(value.conflictStrategy) &&
    isIsoDate(value.expiresAt) &&
    isFailureCode(value.failureCode) &&
    isBoundedString(value.ownerUserId, 256) &&
    isNullableBoundedString(value.parentNodeId, 256) &&
    isProgress(value.progress) &&
    typeof value.contentFingerprint === "string" &&
    sha256Pattern.test(value.contentFingerprint) &&
    typeof value.resumeIdentity === "string" &&
    resumeIdentityPattern.test(value.resumeIdentity) &&
    isBoundedString(value.sessionId, 256) &&
    isSpaceScope(value.spaceScope) &&
    isTransferStatus(value.status) &&
    isBoundedString(value.transferId, 256) &&
    isIsoDate(value.updatedAt) &&
    isNonNegativeInteger(value.uploadedBytes) &&
    isBoundedString(value.workspaceId, 256) &&
    isCanonicalFileName(value.fileName) &&
    isNonNegativeInteger(value.fileSize) &&
    value.uploadedBytes <= value.fileSize &&
    isNonNegativeInteger(value.fileLastModified) &&
    isBoundedString(value.mimeType, 255)
  );
}

async function readBlob(blob: Blob) {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Response(blob).arrayBuffer();
}

async function digestSha256(input: Uint8Array) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Secure upload fingerprinting is unavailable");
  const buffer = new ArrayBuffer(input.byteLength);
  new Uint8Array(buffer).set(input);
  const digest = await subtle.digest("SHA-256", buffer);
  return toHex(new Uint8Array(digest));
}

function toHex(input: Uint8Array) {
  return Array.from(input, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function normalizeMimeType(value: string) {
  return value.trim() || "application/octet-stream";
}

function normalizeNonNegativeInteger(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("Upload file metadata is invalid");
  }
  return Math.trunc(value);
}

function isUploadRecoveryEnvelope(
  value: unknown,
): value is UploadRecoveryEnvelope {
  return (
    isRecord(value) &&
    hasExactKeys(value, uploadRecoveryEnvelopeKeys) &&
    value.version === uploadRecoveryVersion &&
    Array.isArray(value.records) &&
    value.records.length <= maxRecoveryRecords &&
    value.records.every(isUploadRecoveryDescriptor) &&
    new Set(
      value.records.map((descriptor: UploadRecoveryDescriptor) => descriptor.sessionId),
    ).size === value.records.length
  );
}

function projectUploadRecoveryDescriptor(
  descriptor: UploadRecoveryDescriptor,
): UploadRecoveryDescriptor {
  return {
    batchId: descriptor.batchId,
    conflictStrategy: descriptor.conflictStrategy,
    contentFingerprint: descriptor.contentFingerprint,
    expiresAt: descriptor.expiresAt,
    failureCode: descriptor.failureCode,
    fileLastModified: descriptor.fileLastModified,
    fileName: descriptor.fileName,
    fileSize: descriptor.fileSize,
    mimeType: descriptor.mimeType,
    ownerUserId: descriptor.ownerUserId,
    parentNodeId: descriptor.parentNodeId,
    progress: descriptor.progress,
    resumeIdentity: descriptor.resumeIdentity,
    sessionId: descriptor.sessionId,
    spaceScope: descriptor.spaceScope,
    status: descriptor.status,
    transferId: descriptor.transferId,
    updatedAt: descriptor.updatedAt,
    uploadedBytes: descriptor.uploadedBytes,
    version: descriptor.version,
    workspaceId: descriptor.workspaceId,
  };
}

function writeRecoveryEnvelope(
  records: UploadRecoveryDescriptor[],
  storage: UploadRecoveryStorage,
) {
  try {
    if (records.length === 0) {
      storage.removeItem(uploadRecoveryStorageKey);
      return true;
    }
    const envelope: UploadRecoveryEnvelope = {
      records,
      version: uploadRecoveryVersion,
    };
    storage.setItem(uploadRecoveryStorageKey, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

function removeMatchingRecoveryDescriptors(
  predicate: (descriptor: UploadRecoveryDescriptor) => boolean,
  storage: UploadRecoveryStorage,
) {
  const records = readUploadRecoveryDescriptors(storage);
  const remaining = records.filter((descriptor) => !predicate(descriptor));
  const removed = records.length - remaining.length;
  if (removed > 0) writeRecoveryEnvelope(remaining, storage);
  return removed;
}

function removeRecoveryStorage(storage: UploadRecoveryStorage) {
  try {
    storage.removeItem(uploadRecoveryStorageKey);
  } catch {
    // Recovery is best-effort when browser storage is unavailable.
  }
}

function getSessionStorage(): UploadRecoveryStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: ReadonlySet<string>,
) {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.size &&
    keys.every((key) => expectedKeys.has(key))
  );
}

function isBoundedString(
  value: unknown,
  maxLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
  );
}

function isNullableBoundedString(value: unknown, maxLength: number) {
  return value === null || isBoundedString(value, maxLength);
}

function isCanonicalFileName(value: unknown) {
  if (!isBoundedString(value, 1024)) return false;
  const validation = validateDriveFileName(value);
  return validation.ok && validation.name === value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isProgress(value: unknown) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 100
  );
}

function isIsoDate(value: unknown) {
  if (typeof value !== "string" || value.length > 64) return false;
  const parsed = new Date(value);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString() === value
  );
}

function isSpaceScope(value: unknown): value is DriveSpaceScope {
  return value === "workspace" || value === "personal";
}

function isConflictStrategy(
  value: unknown,
): value is UploadRecoveryConflictStrategy {
  return (
    value === "overwrite" ||
    value === "rename" ||
    value === "skip" ||
    value === "version"
  );
}

function isTransferStatus(value: unknown): value is TransferTaskStatus {
  return (
    typeof value === "string" &&
    transferStatuses.has(value as TransferTaskStatus)
  );
}

function isFailureCode(
  value: unknown,
): value is TransferTaskFailureCode | null {
  return (
    value === null ||
    (typeof value === "string" &&
      transferFailureCodes.has(value as TransferTaskFailureCode))
  );
}
