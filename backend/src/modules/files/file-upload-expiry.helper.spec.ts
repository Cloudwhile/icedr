import { FileUploadExpiryManager } from './file-upload-expiry.helper';
import { createUploadSessionRow } from './upload-session-test-fixtures';
import { mapUploadSession } from './upload-session-types';

describe('FileUploadExpiryManager', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not clean storage when an expiry CAS loses to a renewed session', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const expiredSnapshot = mapUploadSession(
      createUploadSessionRow({
        expiresAt: new Date('2026-07-19T00:00:00.000Z'),
        multipartUploadId: 'multipart-test',
      }),
    );
    const renewedSession = mapUploadSession(
      createUploadSessionRow({
        expiresAt: new Date('2026-07-21T00:00:00.000Z'),
        multipartUploadId: 'multipart-test',
      }),
    );
    const uploadSessions = {
      findById: jest.fn(() => Promise.resolve(renewedSession)),
      transitionFailureState: jest.fn(() => Promise.resolve(null)),
    };
    const storage = {
      abortMultipartUpload: jest.fn(() => Promise.resolve()),
      deleteUploadSessionParts: jest.fn(() => Promise.resolve()),
    };
    const manager = new FileUploadExpiryManager(
      uploadSessions as never,
      storage as never,
    );

    await expect(manager.ensure(expiredSnapshot)).resolves.toEqual(
      renewedSession,
    );
    expect(uploadSessions.transitionFailureState).toHaveBeenCalledTimes(1);
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(storage.deleteUploadSessionParts).not.toHaveBeenCalled();
  });

  it('does not clean a virtually expired session until expiry is persisted', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const expiredSnapshot = mapUploadSession(
      createUploadSessionRow({
        expiresAt: new Date('2026-07-19T00:00:00.000Z'),
        multipartUploadId: 'multipart-test',
      }),
    );
    const uploadSessions = {
      findById: jest.fn(() => Promise.resolve(expiredSnapshot)),
      transitionFailureState: jest.fn(() => Promise.resolve(null)),
    };
    const storage = {
      abortMultipartUpload: jest.fn(() => Promise.resolve()),
      deleteUploadSessionParts: jest.fn(() => Promise.resolve()),
    };
    const manager = new FileUploadExpiryManager(
      uploadSessions as never,
      storage as never,
    );

    await expect(manager.ensure(expiredSnapshot)).resolves.toEqual(
      expiredSnapshot,
    );
    expect(uploadSessions.transitionFailureState).toHaveBeenCalledTimes(2);
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
    expect(storage.deleteUploadSessionParts).not.toHaveBeenCalled();
  });
});
