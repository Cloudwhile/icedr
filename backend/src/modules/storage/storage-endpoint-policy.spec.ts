import { validateStorageEndpoint } from './storage-endpoint-policy';

describe('validateStorageEndpoint', () => {
  it('allows private-network MinIO endpoints', () => {
    expect(validateStorageEndpoint('http://10.0.0.12:9000').toString()).toBe(
      'http://10.0.0.12:9000/',
    );
  });

  it('rejects metadata targets, credentials, and unsupported protocols', () => {
    expect(() =>
      validateStorageEndpoint('http://169.254.169.254/latest/meta-data'),
    ).toThrow('blocked metadata endpoint');
    expect(() =>
      validateStorageEndpoint('https://admin:secret@storage.example.com'),
    ).toThrow('must not contain URL credentials');
    expect(() => validateStorageEndpoint('file:///etc/passwd')).toThrow(
      'must use HTTP or HTTPS',
    );
  });
});
