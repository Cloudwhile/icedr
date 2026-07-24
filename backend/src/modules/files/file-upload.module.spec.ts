import { MODULE_METADATA } from '@nestjs/common/constants';
import { FileDownloadPreviewService } from './file-download-preview.service';
import { FileNodesModule } from './file-nodes.module';
import { FileUploadPolicyService } from './file-upload-policy.service';
import { FileUploadService } from './file-upload.service';
import { createFileNodesServiceTestHarness } from './file-upload-test-harness.helper';

describe('FileNodesModule service boundaries', () => {
  it('registers the upload and download-preview providers', () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      FileNodesModule,
    ) as unknown[];

    expect(providers).toEqual(
      expect.arrayContaining([
        FileUploadPolicyService,
        FileUploadService,
        FileDownloadPreviewService,
      ]),
    );
  });

  it('creates isolated mutable state for each test harness', async () => {
    const first = createFileNodesServiceTestHarness();
    const second = createFileNodesServiceTestHarness();

    await first.service.copyFileNode('roadmap', { name: 'First copy.docx' });

    await expect(
      first.service.listFileNodes('workspace-default'),
    ).resolves.toHaveLength(4);
    await expect(
      second.service.listFileNodes('workspace-default'),
    ).resolves.toHaveLength(3);
    expect(first.nodes).not.toBe(second.nodes);
  });
});
