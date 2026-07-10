import { buildAuthenticationMethodStatus } from './authentication-method-status';

describe('buildAuthenticationMethodStatus', () => {
  it('does not count recovery codes as a sign-in method', () => {
    expect(
      buildAuthenticationMethodStatus(
        {
          password: false,
          oauth: false,
          passkey: false,
          recoveryCodes: 10,
        },
        1,
      ),
    ).toEqual({
      compliant: false,
      methodCount: 0,
      minimumAuthenticationMethods: 1,
      methods: {
        password: false,
        oauth: false,
        passkey: false,
        recoveryCodes: 10,
      },
    });
  });

  it('counts only methods that can create a login session', () => {
    expect(
      buildAuthenticationMethodStatus(
        {
          password: true,
          oauth: false,
          passkey: true,
          recoveryCodes: 8,
        },
        2,
      ),
    ).toMatchObject({
      compliant: true,
      methodCount: 2,
      minimumAuthenticationMethods: 2,
    });
  });
});
