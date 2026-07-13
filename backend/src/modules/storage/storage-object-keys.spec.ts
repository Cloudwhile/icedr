import {
  createFileObjectKey,
  getWorkspaceObjectPrefixes,
  hasUnsafePathSegments,
  isUploadObjectKeyForPayload,
} from './storage-object-keys';

describe('storage object keys', () => {
  it('creates opaque v2 workspace-scoped object keys', () => {
    const objectKey = createFileObjectKey({
      distributedStorage: true,
      fileName: 'Customer Notes.pdf',
      now: new Date('2026-06-02T14:00:00.000Z'),
      nonce: 'abcdefghijklmnop',
      workspaceId: 'workspace-default',
    });

    expect(objectKey).toBe(
      'workspaces/workspace-default/spaces/workspace/objects/original/v2/2026/06/abcdefghijklmnop.blob',
    );
    expect(objectKey).not.toContain('Customer');
  });

  it('uses the same layout under local prefix for local storage', () => {
    const objectKey = createFileObjectKey({
      distributedStorage: false,
      fileName: 'Customer Notes.pdf',
      now: new Date('2026-06-02T14:00:00.000Z'),
      nonce: 'abcdefghijklmnop',
      workspaceId: 'workspace-default',
    });

    expect(objectKey).toBe(
      'local/workspaces/workspace-default/spaces/workspace/objects/original/v2/2026/06/abcdefghijklmnop.blob',
    );
  });

  it('creates personal-space object keys separately from workspace keys', () => {
    const objectKey = createFileObjectKey({
      distributedStorage: true,
      fileName: 'Customer Notes.pdf',
      now: new Date('2026-06-02T14:00:00.000Z'),
      nonce: 'abcdefghijklmnop',
      spaceScope: 'personal',
      workspaceId: 'workspace-default',
    });

    expect(objectKey).toBe(
      'workspaces/workspace-default/spaces/personal/objects/original/v2/2026/06/abcdefghijklmnop.blob',
    );
  });

  it('keeps object keys bounded for the longest accepted multibyte name', () => {
    const fileName = '界'.repeat(85);
    const objectKey = createFileObjectKey({
      distributedStorage: true,
      fileName,
      now: new Date('2026-06-02T14:00:00.000Z'),
      nonce: 'abcdefghijklmnop',
      workspaceId: 'workspace-default',
    });

    expect(Buffer.byteLength(objectKey, 'utf8')).toBeLessThanOrEqual(1024);
    expect(objectKey).not.toContain(encodeURIComponent(fileName));
  });

  it('rejects unsafe workspace segments before creating an object key', () => {
    expect(() =>
      createFileObjectKey({
        distributedStorage: false,
        fileName: 'Customer Notes.pdf',
        nonce: 'abcdefghijklmnop',
        workspaceId: '..',
      }),
    ).toThrow();
    expect(() =>
      createFileObjectKey({
        distributedStorage: false,
        fileName: 'Customer Notes.pdf',
        nonce: 'abcdefghijklmnop',
        workspaceId: '.',
      }),
    ).toThrow();
  });

  it('accepts v2, v1, and legacy upload object keys', () => {
    const payload = {
      fileName: 'Customer Notes.pdf',
      workspaceId: 'workspace-default',
    };

    expect(
      isUploadObjectKeyForPayload({
        ...payload,
        objectKey:
          'workspaces/workspace-default/spaces/workspace/objects/original/v2/2026/06/abcdefghijklmnop.blob',
      }),
    ).toBe(true);
    expect(
      isUploadObjectKeyForPayload({
        ...payload,
        objectKey:
          'workspaces/workspace-default/spaces/workspace/objects/original/2026/06/abcdefghijklmnop/Customer%20Notes.pdf',
      }),
    ).toBe(true);
    expect(
      isUploadObjectKeyForPayload({
        ...payload,
        objectKey:
          'workspaces/workspace-default/objects/original/2026/06/abcdefghijklmnop/Customer%20Notes.pdf',
      }),
    ).toBe(true);
    expect(
      isUploadObjectKeyForPayload({
        ...payload,
        objectKey:
          'uploads/workspace-default/root/1760000000000-abcdefghijklmnop-Customer%20Notes.pdf',
      }),
    ).toBe(true);
    expect(
      isUploadObjectKeyForPayload({
        ...payload,
        spaceScope: 'personal',
        objectKey:
          'workspaces/workspace-default/spaces/personal/objects/original/v2/2026/06/abcdefghijklmnop.blob',
      }),
    ).toBe(true);
    expect(
      isUploadObjectKeyForPayload({
        ...payload,
        spaceScope: 'personal',
        objectKey:
          'workspaces/workspace-default/spaces/personal/objects/original/2026/06/abcdefghijklmnop/Customer%20Notes.pdf',
      }),
    ).toBe(true);
    expect(
      isUploadObjectKeyForPayload({
        ...payload,
        spaceScope: 'personal',
        objectKey:
          'workspaces/workspace-default/objects/original/2026/06/abcdefghijklmnop/Customer%20Notes.pdf',
      }),
    ).toBe(false);
    expect(
      isUploadObjectKeyForPayload({
        ...payload,
        spaceScope: 'personal',
        objectKey:
          'uploads/workspace-default/root/1760000000000-abcdefghijklmnop-Customer%20Notes.pdf',
      }),
    ).toBe(false);
  });

  it('accepts local variants of current and legacy workspace keys', () => {
    const payload = {
      fileName: 'Customer Notes.pdf',
      workspaceId: 'workspace-default',
    };
    const objectKeys = [
      'local/workspaces/workspace-default/spaces/workspace/objects/original/v2/2026/06/abcdefghijklmnop.blob',
      'local/workspaces/workspace-default/spaces/workspace/objects/original/2026/06/abcdefghijklmnop/Customer%20Notes.pdf',
      'local/workspaces/workspace-default/objects/original/2026/06/abcdefghijklmnop/Customer%20Notes.pdf',
      'local/uploads/workspace-default/root/1760000000000-abcdefghijklmnop-Customer%20Notes.pdf',
    ];

    for (const objectKey of objectKeys) {
      expect(isUploadObjectKeyForPayload({ ...payload, objectKey })).toBe(true);
    }
  });

  it('rejects dot path segments in otherwise valid object keys', () => {
    expect(
      isUploadObjectKeyForPayload({
        fileName: 'Customer Notes.pdf',
        objectKey:
          'workspaces/./spaces/workspace/objects/original/v2/2026/06/abcdefghijklmnop.blob',
        workspaceId: '.',
      }),
    ).toBe(false);
  });

  it('detects unsafe path segments consistently', () => {
    expect(hasUnsafePathSegments('local/workspaces/file.blob')).toBe(false);
    for (const objectKey of [
      'local/./file.blob',
      'local/../file.blob',
      'local//file.blob',
      'local/file.blob/',
    ]) {
      expect(hasUnsafePathSegments(objectKey)).toBe(true);
    }
  });

  it('returns current and legacy prefixes for workspace reconciliation', () => {
    expect(
      getWorkspaceObjectPrefixes({
        distributedStorage: true,
        workspaceId: 'workspace-default',
      }),
    ).toEqual(['workspaces/workspace-default/', 'uploads/workspace-default/']);
  });
});
