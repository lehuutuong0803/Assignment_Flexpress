import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuthUser, Role } from '../auth/auth-user';
import { ListOrdersQuery } from './dto/list-orders.query';
import { OrderStatus } from './order-status.enum';
import { Order } from './order.entity';
import { OrdersService } from './orders.service';

const dispatcher: AuthUser = {
  sub: 'disp-1',
  companyId: 'company-a',
  role: Role.Dispatcher,
};
const driver: AuthUser = {
  sub: 'driver-1',
  companyId: 'company-a',
  role: Role.Driver,
};

function setup() {
  const repo = {
    create: jest.fn((data: Partial<Order>) => data as Order),
    save: jest.fn((order: Order) =>
      Promise.resolve({ ...order, id: 'order-1' }),
    ),
    findAndCount: jest.fn(() => Promise.resolve([[], 0])),
    findOneBy: jest.fn(() => Promise.resolve(null)),
  };
  const service = new OrdersService(repo as unknown as Repository<Order>);
  return { repo, service };
}

const query = (overrides: Partial<ListOrdersQuery> = {}): ListOrdersQuery =>
  Object.assign(new ListOrdersQuery(), overrides);

describe('OrdersService', () => {
  it('creates an order for the caller company, authored by the caller', async () => {
    const { repo, service } = setup();
    await service.create(dispatcher, {
      pickupAddress: 'A',
      deliveryAddress: 'B',
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 'company-a',
        createdBy: 'disp-1',
        status: OrderStatus.CREATED,
      }),
    );
  });

  it('lists only the driver own orders, newest first, with paging', async () => {
    const { repo, service } = setup();
    await service.findAll(
      driver,
      query({ page: 3, limit: 10, status: OrderStatus.ASSIGNED }),
    );
    expect(repo.findAndCount).toHaveBeenCalledWith({
      where: {
        companyId: 'company-a',
        assignedDriverId: 'driver-1',
        status: OrderStatus.ASSIGNED,
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: 20,
      take: 10,
    });
  });

  it('rejects a date range where from is not before to', async () => {
    const { service } = setup();
    await expect(
      service.findAll(
        dispatcher,
        query({ from: '2026-10-02T00:00:00Z', to: '2026-10-01T00:00:00Z' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('looks up a single order within the caller scope and returns 404 outside it', async () => {
    const { repo, service } = setup();
    await expect(
      service.findOne(dispatcher, 'order-of-company-b'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findOneBy).toHaveBeenCalledWith({
      companyId: 'company-a',
      id: 'order-of-company-b',
    });
  });
});
