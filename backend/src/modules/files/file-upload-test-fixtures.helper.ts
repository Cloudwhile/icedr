import type { Readable } from 'stream';
import type { FileNodeResponse, FileNodeSpaceScope } from './file-nodes.dto';
import { resolveFilePreviewCapability } from './file-preview-policy';
import type { UploadSession } from './upload-sessions.repository';

export const docxMimeType =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type TestUploadSession = UploadSession & {
  completionToken: string | null;
};

export function createNode(
  input: Omit<
    FileNodeResponse,
    | 'archivedBy'
    | 'checksumAlgorithm'
    | 'checksumValue'
    | 'integrityStatus'
    | 'lastVerifiedAt'
    | 'originalParentNodeId'
    | 'originalPath'
    | 'ownerUserId'
    | 'previewCapability'
    | 'spaceScope'
    | 'verificationFailureCode'
  > &
    Partial<
      Pick<
        FileNodeResponse,
        | 'archivedBy'
        | 'checksumAlgorithm'
        | 'checksumValue'
        | 'integrityStatus'
        | 'lastVerifiedAt'
        | 'originalParentNodeId'
        | 'originalPath'
        | 'ownerUserId'
        | 'spaceScope'
        | 'verificationFailureCode'
      >
    >,
): FileNodeResponse {
  const node = {
    archivedBy: null,
    checksumAlgorithm: null,
    checksumValue: null,
    integrityStatus: 'unknown' as const,
    lastVerifiedAt: null,
    originalParentNodeId: null,
    originalPath: null,
    ownerUserId: null,
    spaceScope: 'workspace' as FileNodeSpaceScope,
    verificationFailureCode: null,
    ...input,
  };
  return {
    ...node,
    previewCapability: resolveFilePreviewCapability(node),
  };
}

export function createSeedNodes(): FileNodeResponse[] {
  return [
    createNode({
      id: 'roadmap',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'ICEDR Roadmap.docx',
      kind: 'doc',
      mimeType: docxMimeType,
      sizeBytes: 284 * 1024,
      objectKey: 'uploads/workspace-default/root/seed-roadmap.docx',
      owner: 'Workspace User',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
    createNode({
      id: 'unsafe-html',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'unsafe.html',
      kind: 'doc',
      mimeType: 'text/html',
      sizeBytes: 4096,
      objectKey: 'uploads/workspace-default/root/unsafe.html',
      owner: 'Workspace User',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
    createNode({
      id: 'large-log',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'large.log',
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: 1024 * 1024 + 1,
      objectKey: 'uploads/workspace-default/root/large.log',
      owner: 'Workspace User',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
    createNode({
      id: 'personal-a',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'Personal A.txt',
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: 32,
      objectKey:
        'local/workspaces/workspace-default/users/user-a/personal-a.txt',
      owner: 'User A',
      ownerUserId: 'user-a',
      spaceScope: 'personal',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
    createNode({
      id: 'personal-b',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'Personal B.txt',
      kind: 'doc',
      mimeType: 'text/plain',
      sizeBytes: 32,
      objectKey:
        'local/workspaces/workspace-default/users/user-b/personal-b.txt',
      owner: 'User B',
      ownerUserId: 'user-b',
      spaceScope: 'personal',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
    createNode({
      id: 'personal-folder-b',
      workspaceId: 'workspace-default',
      parentNodeId: null,
      name: 'User B Folder',
      kind: 'folder',
      mimeType: 'inode/directory',
      sizeBytes: null,
      objectKey: null,
      owner: 'User B',
      ownerUserId: 'user-b',
      spaceScope: 'personal',
      starred: false,
      archivedAt: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }),
  ];
}

export async function readStreamSize(stream: Readable) {
  let sizeBytes = 0;
  for await (const chunk of stream) {
    sizeBytes += Buffer.isBuffer(chunk)
      ? chunk.length
      : Buffer.byteLength(String(chunk));
  }
  return sizeBytes;
}
