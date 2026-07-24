export function readPath(
  value: unknown,
  path: ReadonlyArray<string | number>,
): unknown {
  let current = value;

  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) {
        throw new TypeError(`Expected an array at path segment ${segment}`);
      }
      current = current[segment];
      continue;
    }

    if (typeof current !== 'object' || current === null) {
      throw new TypeError(`Expected an object at path segment ${segment}`);
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

export function createUploadSessionRow(
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'upload_session_test',
    transferId: 'transfer_test',
    nodeId: null,
    ownerUserId: 'user-a',
    workspaceId: 'workspace-default',
    spaceScope: 'workspace',
    conflictStrategy: 'version',
    objectKey: 'uploads/test.bin',
    multipartUploadId: null,
    resumeKey: 'resume-test',
    fileName: 'test.bin',
    parentNodeId: null,
    mimeType: 'application/octet-stream',
    sizeBytes: BigInt(1024),
    chunkSizeBytes: 256,
    status: 'running',
    failureCode: null,
    expiresAt: new Date('2026-07-19T00:00:00.000Z'),
    completionToken: null,
    completionStartedAt: null,
    storageFinalizedAt: null,
    createdAt: new Date('2026-07-18T00:00:00.000Z'),
    updatedAt: new Date('2026-07-18T00:00:00.000Z'),
    ...overrides,
  };
}

export function createTransferTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'transfer_test',
    workspaceId: 'workspace-default',
    ownerUserId: 'user-a',
    nodeId: null,
    objectKey: 'uploads/test.bin',
    name: 'test.bin',
    transferType: 'upload',
    progress: 95,
    status: 'running',
    failureCode: null,
    expiresAt: new Date('2026-07-19T00:00:00.000Z'),
    createdAt: new Date('2026-07-18T00:00:00.000Z'),
    updatedAt: new Date('2026-07-18T00:00:00.000Z'),
    ...overrides,
  };
}
