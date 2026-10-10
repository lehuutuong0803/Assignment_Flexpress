import { ForbiddenException } from '@nestjs/common';
import {
  COMPANY_A,
  createTestKeys,
  TEST_AUDIENCE,
  TEST_ISSUER,
  TestKeys,
} from '../../test/support/tokens';
import { Role } from './auth-user';
import { TokenVerifier } from './token-verifier';

describe('TokenVerifier', () => {
  let keys: TestKeys;
  let verifier: TokenVerifier;

  beforeAll(async () => {
    keys = await createTestKeys();
    verifier = new TokenVerifier(keys.jwks, {
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
    });
  });

  it('returns the caller for a valid token', async () => {
    const token = await keys.sign({
      sub: 'user-1',
      realm_access: { roles: ['driver', 'offline_access'] },
    });
    await expect(verifier.verify(token)).resolves.toEqual({
      sub: 'user-1',
      companyId: COMPANY_A,
      role: Role.Driver,
    });
  });

  describe('rejects an invalid token', () => {
    it('signed by a key that is not in the JWKS', async () => {
      await expect(
        verifier.verify(await keys.signWithUntrustedKey()),
      ).rejects.toThrow();
    });

    it('from another issuer', async () => {
      const token = await keys.sign(
        {},
        { issuer: 'http://evil.example/realms/flexpress' },
      );
      await expect(verifier.verify(token)).rejects.toThrow(/iss/);
    });

    it('for another audience', async () => {
      const token = await keys.sign({}, { audience: 'some-other-api' });
      await expect(verifier.verify(token)).rejects.toThrow(/aud/);
    });

    it('that has expired', async () => {
      const token = await keys.sign({}, { expiresIn: '-1m' });
      await expect(verifier.verify(token)).rejects.toThrow(/exp/);
    });

    it('that is not a JWT', async () => {
      await expect(verifier.verify('not-a-jwt')).rejects.toThrow();
    });
  });

  describe('forbids a valid token that cannot be used here', () => {
    it.each([
      ['no company_id', { company_id: undefined }],
      ['a company_id that is not a UUID', { company_id: 'company-a' }],
      ['no delivery role', { realm_access: { roles: ['offline_access'] } }],
      ['both roles', { realm_access: { roles: ['dispatcher', 'driver'] } }],
    ])('%s', async (_case, claims) => {
      const token = await keys.sign(claims);
      await expect(verifier.verify(token)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
