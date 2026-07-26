import { ServiceUnavailableException } from '@nestjs/common';
import {
  createDto,
  createSharesServiceHarness,
} from './shares.service.spec-harness';

describe('SharesService bootstrap gate', () => {
  it('fails closed before every public share operation when setup is incomplete', async () => {
    const { bootstrapSettingFindUnique, service, setBootstrapState } =
      createSharesServiceHarness();
    setBootstrapState(null);
    const accountUser = {
      avatarUrl: null,
      displayName: 'Mina',
      email: 'mina@example.test',
      id: 'user-1',
    };
    const publicRequests: Array<() => Promise<unknown>> = [
      () => service.getShare('share-token'),
      () =>
        service.sendEmailAccessCode('share-token', {
          email: 'visitor@example.test',
        }),
      () =>
        service.verifyEmailAccessCode('share-token', {
          code: '123456',
          email: 'visitor@example.test',
        }),
      () =>
        service.createVerifiedAccountAccessSession('share-token', accountUser),
      () => service.createDownloadIntent('share-token', 'node-1'),
      () => service.downloadSharedNode('share-token', 'node-1', 'download-1'),
      () => service.createPreviewIntent('share-token', 'node-1'),
      () => service.getPreviewStatus('share-token', 'node-1', 'preview-1'),
    ];

    for (const request of publicRequests) {
      await expectSetupRequired(request());
    }
    expect(bootstrapSettingFindUnique).toHaveBeenCalledTimes(
      publicRequests.length,
    );
  });

  it('fails closed without reading a share when bootstrap state lookup fails', async () => {
    const { repository, service, setBootstrapLookupError } =
      createSharesServiceHarness();
    const findByToken = jest.spyOn(repository, 'findByToken');
    setBootstrapLookupError(new Error('database unavailable'));

    await expectSetupRequired(service.getShare('share-token'));

    expect(findByToken).not.toHaveBeenCalled();
  });

  it('keeps normal anonymous share reads available after setup completes', async () => {
    const { bootstrapSettingFindUnique, service } =
      createSharesServiceHarness();
    const created = await service.createShare(createDto());

    await expect(service.getShare(created.token)).resolves.toMatchObject({
      token: created.token,
      title: 'ICEDR Roadmap.docx',
    });
    expect(bootstrapSettingFindUnique).toHaveBeenCalledTimes(1);
  });
});

async function expectSetupRequired(promise: Promise<unknown>) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ServiceUnavailableException);
  expect(caught).toMatchObject({ response: { code: 'SETUP_REQUIRED' } });
}
