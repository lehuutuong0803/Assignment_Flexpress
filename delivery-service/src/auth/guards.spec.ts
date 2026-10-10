import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser, Role } from './auth-user';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { TokenVerifier } from './token-verifier';

const driver: AuthUser = { sub: 'driver-1', companyId: 'c', role: Role.Driver };

function contextFor(request: object, metadata: Record<string, unknown> = {}) {
  const handler = () => undefined;
  Object.entries(metadata).forEach(([key, value]) =>
    Reflect.defineMetadata(key, value, handler),
  );
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const verify = jest.fn<Promise<AuthUser>, [string]>();
  const guard = new JwtAuthGuard(new Reflector(), {
    verify,
  } as unknown as TokenVerifier);

  beforeEach(() => verify.mockReset());

  it('lets @Public() routes through without a token', async () => {
    await expect(
      guard.canActivate(contextFor({ headers: {} }, { [IS_PUBLIC_KEY]: true })),
    ).resolves.toBe(true);
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([
    ['no Authorization header', {}],
    ['a non-bearer scheme', { authorization: 'Basic dXNlcjpwYXNz' }],
    ['an empty bearer token', { authorization: 'Bearer ' }],
  ])('returns 401 for %s', async (_case, headers) => {
    await expect(
      guard.canActivate(contextFor({ headers })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns 401 without details when verification fails', async () => {
    verify.mockRejectedValue(new Error('"aud" claim check failed'));
    const error = await guard
      .canActivate(contextFor({ headers: { authorization: 'Bearer t' } }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as Error).message).toBe('Invalid or expired token');
  });

  it('passes through a 403 from the verifier', async () => {
    verify.mockRejectedValue(
      new ForbiddenException('Token has no valid company_id'),
    );
    await expect(
      guard.canActivate(contextFor({ headers: { authorization: 'Bearer t' } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('attaches the verified user to the request', async () => {
    verify.mockResolvedValue(driver);
    const request: { headers: object; user?: AuthUser } = {
      headers: { authorization: 'Bearer good' },
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('good');
    expect(request.user).toEqual(driver);
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows any authenticated user when no role is required', () => {
    expect(guard.canActivate(contextFor({ user: driver }))).toBe(true);
  });

  it('allows a user with a required role', () => {
    expect(
      guard.canActivate(
        contextFor({ user: driver }, { [ROLES_KEY]: [Role.Driver] }),
      ),
    ).toBe(true);
  });

  it('returns 403 for a user without a required role', () => {
    expect(() =>
      guard.canActivate(
        contextFor({ user: driver }, { [ROLES_KEY]: [Role.Dispatcher] }),
      ),
    ).toThrow(ForbiddenException);
  });
});
