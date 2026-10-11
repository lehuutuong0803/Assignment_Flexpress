import { OrderStatus } from '../order-status.enum';
import { Order } from '../order.entity';

/** The API shape of an order. Mapped explicitly so new entity columns are never exposed by accident. */
export class OrderResponse {
  id!: string;
  companyId!: string;
  pickupAddress!: string;
  deliveryAddress!: string;
  assignedDriverId!: string | null;
  status!: OrderStatus;
  podObjectKey!: string | null;
  createdBy!: string;
  createdAt!: Date;
  updatedAt!: Date;
}

export class PaginatedOrders {
  items!: OrderResponse[];
  page!: number;
  limit!: number;
  total!: number;
}

export function toOrderResponse(order: Order): OrderResponse {
  return {
    id: order.id,
    companyId: order.companyId,
    pickupAddress: order.pickupAddress,
    deliveryAddress: order.deliveryAddress,
    assignedDriverId: order.assignedDriverId,
    status: order.status,
    podObjectKey: order.podObjectKey,
    createdBy: order.createdBy,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
