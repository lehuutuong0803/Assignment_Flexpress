import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  And,
  FindOptionsWhere,
  LessThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQuery } from './dto/list-orders.query';
import {
  OrderResponse,
  PaginatedOrders,
  toOrderResponse,
} from './dto/order.response';
import { orderScope } from './order-scope';
import { OrderStatus } from './order-status.enum';
import { Order } from './order.entity';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
  ) {}

  async create(user: AuthUser, dto: CreateOrderDto): Promise<OrderResponse> {
    // Fields are assigned one by one: tenant and author always come from the token.
    const order = this.orders.create({
      companyId: user.companyId,
      createdBy: user.sub,
      pickupAddress: dto.pickupAddress,
      deliveryAddress: dto.deliveryAddress,
      status: OrderStatus.CREATED,
      assignedDriverId: null,
      podObjectKey: null,
    });
    const saved = await this.orders.save(order);
    // ids only: addresses are personal data and stay out of logs.
    this.logger.log(
      {
        orderId: saved.id,
        companyId: saved.companyId,
        createdBy: saved.createdBy,
      },
      'order created',
    );
    return toOrderResponse(saved);
  }

  async findAll(
    user: AuthUser,
    query: ListOrdersQuery,
  ): Promise<PaginatedOrders> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from >= to) {
      throw new BadRequestException('"from" must be earlier than "to"');
    }

    // Start from the caller's scope; filters only narrow it further.
    const where: FindOptionsWhere<Order> = { ...orderScope(user) };
    if (query.status) {
      where.status = query.status;
    }
    if (from && to) {
      where.createdAt = And(MoreThanOrEqual(from), LessThan(to));
    } else if (from) {
      where.createdAt = MoreThanOrEqual(from);
    } else if (to) {
      where.createdAt = LessThan(to);
    }

    const [orders, total] = await this.orders.findAndCount({
      where,
      // `id` breaks ties between equal timestamps, so pages don't overlap or skip rows.
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    return {
      items: orders.map(toOrderResponse),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async findOne(user: AuthUser, id: string): Promise<OrderResponse> {
    // Scope and id in one query: an order outside the caller's scope is simply "not found",
    // so the response never reveals that it exists.
    const order = await this.orders.findOneBy({ ...orderScope(user), id });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return toOrderResponse(order);
  }
}
