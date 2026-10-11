import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { StorageService } from '../storage/storage.service';
import { OrderResponse, toOrderResponse } from './dto/order.response';
import {
  AssignOrderDto,
  ChangeStatusDto,
  OrderStatusEventResponse,
  PodContentType,
  ProofOfDeliveryRequestDto,
  ProofOfDeliveryUpload,
} from './dto/workflow.dto';
import { IdempotencyKey } from './idempotency-key.entity';
import { orderScope } from './order-scope';
import { OrderStatusEvent } from './order-status-event.entity';
import { OrderStatus } from './order-status.enum';
import { assertTransition } from './order-status.machine';
import { Order } from './order.entity';

export const IDEMPOTENCY_KEY_TTL_HOURS = 24;
export const POD_URL_TTL_SECONDS = 300;
const POD_EXTENSIONS: Record<PodContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface StatusChangeResult {
  statusCode: number;
  body: OrderResponse;
  /** True when the stored response of an earlier request with the same key was returned. */
  replayed: boolean;
}

class ConcurrentUpdateException extends ConflictException {
  constructor() {
    super({
      error: 'CONCURRENT_UPDATE',
      message: 'The order was changed by another request. Reload it and retry.',
    });
  }
}

/** Status changes: assignment, driver updates (idempotent), proof of delivery, history. */
@Injectable()
export class OrderWorkflowService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(OrderStatusEvent)
    private readonly events: Repository<OrderStatusEvent>,
    @InjectRepository(IdempotencyKey)
    private readonly keys: Repository<IdempotencyKey>,
    private readonly storage: StorageService,
  ) {}

  /** Dispatcher: CREATED → ASSIGNED and set the driver, in one transaction with its event. */
  async assign(
    user: AuthUser,
    orderId: string,
    dto: AssignOrderDto,
  ): Promise<OrderResponse> {
    const order = await this.findScoped(user, orderId);
    assertTransition(order.status, OrderStatus.ASSIGNED);
    const updated = await this.dataSource.transaction((m) =>
      this.applyTransition(m, user, order, OrderStatus.ASSIGNED, {
        set: { assignedDriverId: dto.driverId },
      }),
    );
    return toOrderResponse(updated);
  }

  /** Driver: PICKED_UP onward. Safe to retry with the same Idempotency-Key. */
  async changeStatus(
    user: AuthUser,
    orderId: string,
    dto: ChangeStatusDto,
    rawKey: string | undefined,
  ): Promise<StatusChangeResult> {
    const key = parseIdempotencyKey(rawKey);
    const requestHash = hashRequest(orderId, dto);

    const replay = await this.findReplay(user, key, requestHash);
    if (replay) {
      return replay;
    }

    const order = await this.findScoped(user, orderId);
    assertTransition(order.status, dto.status);
    if (dto.status === OrderStatus.DELIVERED) {
      await this.assertProofOfDelivery(order);
    }

    try {
      return await this.dataSource.transaction(async (m) => {
        const updated = await this.applyTransition(m, user, order, dto.status, {
          reason: dto.reason,
          lat: dto.lat,
          lng: dto.lng,
        });
        const body = toOrderResponse(updated);
        // Same transaction as the change: either both are stored or neither is.
        await m.insert(IdempotencyKey, {
          key,
          userId: user.sub,
          requestHash,
          statusCode: 200,
          responseBody: body,
        });
        return { statusCode: 200, body, replayed: false };
      });
    } catch (error) {
      // A concurrent request with the same key won the race: its transaction committed first, so
      // ours hit the unique key or found the status already changed. Return its stored response.
      if (
        isUniqueViolation(error) ||
        error instanceof ConcurrentUpdateException
      ) {
        const winner = await this.findReplay(user, key, requestHash);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  /** Driver: presigned PUT URL for the photo; the object key is stored on the order. */
  async requestProofOfDelivery(
    user: AuthUser,
    orderId: string,
    dto: ProofOfDeliveryRequestDto,
  ): Promise<ProofOfDeliveryUpload> {
    const order = await this.findScoped(user, orderId);
    if (order.status !== OrderStatus.IN_TRANSIT) {
      throw new ConflictException({
        error: 'INVALID_STATE',
        message: `Proof of delivery can only be uploaded while the order is IN_TRANSIT (current: ${order.status})`,
      });
    }

    const objectKey = `orders/${order.id}/pod/${randomUUID()}.${POD_EXTENSIONS[dto.contentType]}`;
    const upload = await this.storage.presignPut(
      objectKey,
      dto.contentType,
      POD_URL_TTL_SECONDS,
    );

    const result = await this.orders
      .createQueryBuilder()
      .update(Order)
      .set({ podObjectKey: objectKey })
      .where('id = :id AND status = :status', {
        id: order.id,
        status: OrderStatus.IN_TRANSIT,
      })
      .execute();
    if (result.affected !== 1) {
      throw new ConcurrentUpdateException();
    }

    return {
      uploadUrl: upload.url,
      method: 'PUT',
      headers: { 'Content-Type': dto.contentType },
      objectKey,
      expiresInSeconds: upload.expiresInSeconds,
    };
  }

  async listEvents(
    user: AuthUser,
    orderId: string,
  ): Promise<OrderStatusEventResponse[]> {
    await this.findScoped(user, orderId); // 404 outside the caller's scope
    const events = await this.events.find({
      where: { orderId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return events.map((e) => ({
      id: e.id,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorId: e.actorId,
      actorRole: e.actorRole,
      reason: e.reason,
      lat: e.lat,
      lng: e.lng,
      createdAt: e.createdAt,
    }));
  }

  private async findScoped(user: AuthUser, orderId: string): Promise<Order> {
    const order = await this.orders.findOneBy({
      ...orderScope(user),
      id: orderId,
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /**
   * Conditional update (`WHERE status = :from`): if another request changed the order since we
   * read it, 0 rows match and we return 409 instead of overwriting. Then append the event.
   */
  private async applyTransition(
    m: EntityManager,
    user: AuthUser,
    order: Order,
    to: OrderStatus,
    opts: { set?: Partial<Order>; reason?: string; lat?: number; lng?: number },
  ): Promise<Order> {
    const result = await m
      .createQueryBuilder()
      .update(Order)
      .set({ ...opts.set, status: to })
      .where('id = :id AND company_id = :companyId AND status = :from', {
        id: order.id,
        companyId: user.companyId,
        from: order.status,
      })
      .execute();
    if (result.affected !== 1) {
      throw new ConcurrentUpdateException();
    }

    await m.insert(OrderStatusEvent, {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: to,
      actorId: user.sub,
      actorRole: user.role,
      reason: opts.reason ?? null,
      lat: opts.lat ?? null,
      lng: opts.lng ?? null,
    });
    return m.findOneByOrFail(Order, { id: order.id });
  }

  private async assertProofOfDelivery(order: Order): Promise<void> {
    if (
      !order.podObjectKey ||
      !(await this.storage.exists(order.podObjectKey))
    ) {
      throw new ConflictException({
        error: 'PROOF_OF_DELIVERY_REQUIRED',
        message:
          'Upload a proof-of-delivery photo before marking the order DELIVERED',
      });
    }
  }

  private async findReplay(
    user: AuthUser,
    key: string,
    requestHash: string,
  ): Promise<StatusChangeResult | null> {
    const stored = await this.keys.findOneBy({ key, userId: user.sub });
    if (!stored) {
      return null;
    }
    const ageMs = Date.now() - stored.createdAt.getTime();
    if (ageMs > IDEMPOTENCY_KEY_TTL_HOURS * 3_600_000) {
      await this.keys.delete({ key, userId: user.sub }); // expired: treat as a new request
      return null;
    }
    if (stored.requestHash !== requestHash) {
      throw new UnprocessableEntityException({
        error: 'IDEMPOTENCY_KEY_REUSED',
        message:
          'This Idempotency-Key was already used with a different request',
      });
    }
    return {
      statusCode: stored.statusCode,
      body: stored.responseBody as OrderResponse,
      replayed: true,
    };
  }
}

function parseIdempotencyKey(raw: string | undefined): string {
  const key = raw?.trim();
  if (!key || key.length > 255 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new BadRequestException(
      'Idempotency-Key header is required (1-255 visible ASCII characters, e.g. a UUID)',
    );
  }
  return key;
}

/** Order id + normalized body, with a fixed field order so equal requests hash equally. */
function hashRequest(orderId: string, dto: ChangeStatusDto): string {
  const canonical = JSON.stringify([
    orderId,
    dto.status,
    dto.reason ?? null,
    dto.lat ?? null,
    dto.lng ?? null,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === '23505'
  );
}
