import {
  createFileObjectKey,
  getWorkspaceObjectPrefixes,
  isUploadObjectKeyForPayload,
} from './storage-object-keys';

describe('storage object keys', () => {
  it('creates stable workspace-scoped object keys without parent folder paths', () => {
    const objectKey = createFileObjectKey({
      distributedStorage: true,
      fileName: 'Customer Notes.pdf',
      now: new Date('2026-06-02T14:00:00.000Z'),
      nonce: 'abcdefghijklmnop',
      workspaceId: 'workspace-default',
    });

    expect(objectKey).toBe(
      'workspaces/workspace-default/objects/original/2026/06/abcdefghijklmnop/Customer%20Notes.pdf',
    );
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
      'local/workspaces/workspace-default/objects/original/2026/06/abcdefghijklmnop/Customer%20Notes.pdf',
    );
  });

  it('accepts current and legacy upload object keys for existing records', () => {
    const payload = {
      fileName: 'Customer Notes.pdf',
      workspaceId: 'workspace-default',
    };

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
