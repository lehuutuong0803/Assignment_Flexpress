import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { Role } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQuery } from './dto/list-orders.query';
import { OrderResponse, PaginatedOrders } from './dto/order.response';
import { OrdersService } from './orders.service';

// Every route requires a token (global JwtAuthGuard). Which orders a caller sees is decided by
// orderScope in the service, not here.
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Roles(Role.Dispatcher)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderResponse> {
    return this.orders.create(user, dto);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: ListOrdersQuery,
  ): Promise<PaginatedOrders> {
    return this.orders.findAll(user, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderResponse> {
    return this.orders.findOne(user, id);
  }
}
