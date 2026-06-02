import { UnauthorizedException } from '@nestjs/common';
import {
  createDerivedOAuthEmail,
  mapIcetowneBlogUserProfile,
  mapOidcUserProfile,
} from './oauth-provider-adapters';

jest.mock('openid-client', () => ({
  __esModule: true,
}));

describe('OAuth provider adapters', () => {
  it('maps standard OIDC user fields into the local identity shape', () => {
    const user = mapOidcUserProfile({
      subject: 'oidc-subject-1',
      email: 'User@Example.COM',
      displayName: 'OIDC User',
    });

    expect(user).toEqual({
      provider: 'oauth',
      providerProfile: 'oidc',
      subject: 'oidc-subject-1',
      email: 'user@example.com',
      emailSource: 'provider',
      displayName: 'OIDC User',
    });
  });

  it('marks missing OIDC email as a derived identity address', () => {
    const user = mapOidcUserProfile({
      subject: 'oidc-subject-without-email',
      displayName: 'No Mail',
    });

    expect(user.email).toBe(
      createDerivedOAuthEmail('oidc', 'oidc-subject-without-email'),
    );
    expect(user.email).toMatch(/^oidc\+[a-z0-9_-]+@identity\.local$/);
    expect(user.emailSource).toBe('derived');
    expect(user.displayName).toBe('No Mail');
  });

  it('maps ICETOWNE BLOG compatibility user fields from nested payloads', () => {
    const user = mapIcetowneBlogUserProfile(
      {
        user: {
          ID: 42,
          user_email: 'blogger@example.com',
          user_login: 'ice-blogger',
        },
      },
      {},
    );

    expect(user).toEqual({
      provider: 'icetowne-blog',
      providerProfile: 'icetowne-blog',
      subject: '42',
      email: 'blogger@example.com',
      emailSource: 'provider',
      displayName: 'ice-blogger',
    });
  });

  it('marks missing ICETOWNE BLOG email as a compatibility derived address', () => {
    const user = mapIcetowneBlogUserProfile(
      {
        user: {
          userId: 'legacy-user',
        },
      },
      {},
    );

    expect(user.email).toBe(
      createDerivedOAuthEmail('icetowne-blog', 'legacy-user'),
    );
    expect(user.email).toMatch(/^icetowne-blog\+[a-z0-9_-]+@identity\.local$/);
    expect(user.emailSource).toBe('derived');
    expect(user.displayName).toBe('ICETOWNE BLOG User');
  });

  it('rejects provider payloads without a stable subject', () => {
    expect(() => mapOidcUserProfile({ email: 'user@example.com' })).toThrow(
      UnauthorizedException,
    );
    expect(() => mapIcetowneBlogUserProfile({}, {})).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects malformed provider emails instead of storing them', () => {
    expect(() =>
      mapOidcUserProfile({
        subject: 'oidc-subject-2',
        email: 'not-an-email',
      }),
    ).toThrow(UnauthorizedException);
  });
});
