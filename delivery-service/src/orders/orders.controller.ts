import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { Role } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQuery } from './dto/list-orders.query';
import { OrderResponse, PaginatedOrders } from './dto/order.response';
import {
  AssignOrderDto,
  ChangeStatusDto,
  OrderStatusEventResponse,
  ProofOfDeliveryRequestDto,
  ProofOfDeliveryUpload,
} from './dto/workflow.dto';
import { OrderWorkflowService } from './order-workflow.service';
import { OrdersService } from './orders.service';

// Every route requires a token (global JwtAuthGuard). Which orders a caller sees is decided by
// orderScope in the services, not here.
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly workflow: OrderWorkflowService,
  ) {}

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

  /** Dispatcher assigns a driver: CREATED → ASSIGNED. */
  @Post(':id/assign')
  @Roles(Role.Dispatcher)
  @HttpCode(200)
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignOrderDto,
  ): Promise<OrderResponse> {
    return this.workflow.assign(user, id, dto);
  }

  /** Assigned driver moves the order on (PICKED_UP, IN_TRANSIT, DELIVERED, FAILED). Retry-safe. */
  @Post(':id/status')
  @Roles(Role.Driver)
  @HttpCode(200)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Unique per logical request (e.g. a UUID). Retrying with the same key and body returns the stored response without a second change; the same key with a different body returns 422. Keys expire after 24 hours.',
  })
  async changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrderResponse> {
    const result = await this.workflow.changeStatus(
      user,
      id,
      dto,
      idempotencyKey,
    );
    if (result.replayed) {
      res.setHeader('Idempotent-Replayed', 'true');
    }
    return result.body;
  }

  /** Assigned driver gets a presigned upload URL for the proof-of-delivery photo. */
  @Post(':id/proof-of-delivery')
  @Roles(Role.Driver)
  @HttpCode(200)
  requestProofOfDelivery(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ProofOfDeliveryRequestDto,
  ): Promise<ProofOfDeliveryUpload> {
    return this.workflow.requestProofOfDelivery(user, id, dto);
  }

  /** Status history (append-only), oldest first. */
  @Get(':id/events')
  listEvents(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderStatusEventResponse[]> {
    return this.workflow.listEvents(user, id);
  }
}
