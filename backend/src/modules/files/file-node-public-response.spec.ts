import { toPublicFileNode } from './file-node-public-response';
import type { FileNodeResponse } from './file-nodes.dto';

function createNode(objectKey: string | null): FileNodeResponse {
  return {
    id: 'node-1',
    workspaceId: 'workspace-default',
    spaceScope: 'workspace',
    parentNodeId: null,
    name: 'Roadmap.txt',
    kind: 'doc',
    mimeType: 'text/plain',
    sizeBytes: 16,
    objectKey,
    owner: 'Mina',
    ownerUserId: 'user-1',
    starred: false,
    archivedAt: null,
    archivedBy: null,
    originalParentNodeId: null,
    originalPath: null,
    previewCapability: {
      supported: true,
      renderMode: 'text',
      reason: 'previewable',
      maxPreviewBytes: 1024,
      sanitized: false,
      downloadOnly: false,
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

describe('toPublicFileNode', () => {
  it('replaces internal object keys with a content capability flag', () => {
    const publicNode = toPublicFileNode(
      createNode('local/workspaces/workspace-default/roadmap.txt'),
    );

    expect(publicNode).not.toHaveProperty('objectKey');
    expect(publicNode.hasContent).toBe(true);
  });

  it('marks folders and missing objects as contentless', () => {
    expect(toPublicFileNode(createNode(null)).hasContent).toBe(false);
  });
});
