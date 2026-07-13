import 'reflect-metadata';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';

describe('AuthController security routes', () => {
  const routePaths = Object.getOwnPropertyNames(AuthController.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = Object.getOwnPropertyDescriptor(
        AuthController.prototype,
        name,
      )?.value as object | undefined;
      const path: unknown = handler
        ? Reflect.getMetadata(PATH_METADATA, handler)
        : undefined;
      return typeof path === 'string' ? path : undefined;
    });

  it('keeps recovery codes behind an authenticated reauthentication route', () => {
    expect(routePaths).toContain('security/reauth/recovery-code');
  });

  it('does not expose a recovery-code session login route', () => {
    expect(routePaths).not.toContain('security/recovery-login');
  });
});
