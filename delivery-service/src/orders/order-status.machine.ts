import { ConflictException } from '@nestjs/common';
import { OrderStatus } from './order-status.enum';

/**
 * The only source of truth for status changes:
 *   CREATED → ASSIGNED → PICKED_UP → IN_TRANSIT → DELIVERED
 *                                              ↘ FAILED (reason required)
 * DELIVERED and FAILED are final.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  [OrderStatus.CREATED]: [OrderStatus.ASSIGNED],
  [OrderStatus.ASSIGNED]: [OrderStatus.PICKED_UP],
  [OrderStatus.PICKED_UP]: [OrderStatus.IN_TRANSIT],
  [OrderStatus.IN_TRANSIT]: [OrderStatus.DELIVERED, OrderStatus.FAILED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.FAILED]: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** 409 with the response body required by the API contract. */
export class InvalidTransitionException extends ConflictException {
  constructor(from: OrderStatus, to: OrderStatus) {
    const allowed = ALLOWED_TRANSITIONS[from];
    super({
      error: 'INVALID_TRANSITION',
      message: `Cannot change status from ${from} to ${to}. Allowed: ${
        allowed.length > 0 ? allowed.join(', ') : 'none (final status)'
      }`,
    });
  }
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionException(from, to);
  }
}
