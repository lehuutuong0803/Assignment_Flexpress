import { Role } from '../auth/auth-user';
import { orderScope } from './order-scope';

describe('orderScope', () => {
  it('limits a dispatcher to their company', () => {
    expect(
      orderScope({
        sub: 'disp-1',
        companyId: 'company-a',
        role: Role.Dispatcher,
      }),
    ).toEqual({
      companyId: 'company-a',
    });
  });

  it('limits a driver to their company and to orders assigned to them', () => {
    expect(
      orderScope({
        sub: 'driver-1',
        companyId: 'company-a',
        role: Role.Driver,
      }),
    ).toEqual({
      companyId: 'company-a',
      assignedDriverId: 'driver-1',
    });
  });
});
