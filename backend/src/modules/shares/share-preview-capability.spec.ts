import {
  createSharePreviewCapability,
  readSharePreviewCapability,
} from './share-preview-capability';

const secret = 'share-preview-capability-secret-for-tests-1234567890';
const config = {
  get: (key: string) =>
    key === 'share.visitorHashSecret' ? secret : undefined,
};

describe('share preview capability', () => {
  it('keeps the artifact id opaque and binds it to one share and node', () => {
    const capability = createSharePreviewCapability(config, {
      artifactPreviewId: 'preview-private-artifact',
      nodeId: 'node-a',
      shareToken: 'share-a',
    });

    expect(capability).toMatch(/^spv1\./);
    expect(capability).not.toContain('preview-private-artifact');
    expect(
      readSharePreviewCapability(config, {
        capability,
        nodeId: 'node-a',
        shareToken: 'share-a',
      }),
    ).toBe('preview-private-artifact');
    expect(
      readSharePreviewCapability(config, {
        capability,
        nodeId: 'node-b',
        shareToken: 'share-a',
      }),
    ).toBeNull();
    expect(
      readSharePreviewCapability(config, {
        capability,
        nodeId: 'node-a',
        shareToken: 'share-b',
      }),
    ).toBeNull();
  });

  it('rejects malformed and tampered capabilities', () => {
    const capability = createSharePreviewCapability(config, {
      artifactPreviewId: 'preview-test',
      nodeId: 'node-a',
      shareToken: 'share-a',
    });
    const tampered = `${capability.slice(0, -1)}${capability.endsWith('A') ? 'B' : 'A'}`;

    expect(
      readSharePreviewCapability(config, {
        capability: 'preview-test',
        nodeId: 'node-a',
        shareToken: 'share-a',
      }),
    ).toBeNull();
    expect(
      readSharePreviewCapability(config, {
        capability: tampered,
        nodeId: 'node-a',
        shareToken: 'share-a',
      }),
    ).toBeNull();
  });
});
