import { validateOAuthHttpUrl } from './oauth-url-policy';

describe('validateOAuthHttpUrl', () => {
  it('accepts HTTPS OAuth endpoints without embedded credentials', () => {
    expect(
      validateOAuthHttpUrl('https://identity.example.com/oauth', {
        label: 'OAuth issuer URL',
        production: true,
      }).toString(),
    ).toBe('https://identity.example.com/oauth');
  });

  it('rejects insecure production endpoints and URL credentials', () => {
    expect(() =>
      validateOAuthHttpUrl('http://identity.example.com', {
        label: 'OAuth issuer URL',
        production: true,
      }),
    ).toThrow('must use HTTPS');
    expect(() =>
      validateOAuthHttpUrl('https://user:secret@identity.example.com', {
        label: 'OAuth issuer URL',
        production: false,
      }),
    ).toThrow('must not contain URL credentials');
  });

  it('blocks direct cloud metadata and link-local targets', () => {
    for (const endpoint of [
      'http://169.254.169.254/latest/meta-data',
      'https://metadata.google.internal',
      'https://100.100.100.200/latest/meta-data',
      'https://[fd00:ec2::254]/latest/meta-data',
    ]) {
      expect(() =>
        validateOAuthHttpUrl(endpoint, {
          label: 'OAuth endpoint',
          production: false,
        }),
      ).toThrow('blocked metadata endpoint');
    }
  });
});
