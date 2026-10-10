import { FindOptionsWhere } from 'typeorm';
import { AuthUser, Role } from '../auth/auth-user';
import { Order } from './order.entity';

/**
 * The only place that decides which orders a caller may see. Every orders read goes through it.
 * - dispatcher: all orders of their company
 * - driver: only orders of their company that are assigned to them
 * Values come from the verified token, never from the request.
 */
export function orderScope(user: AuthUser): FindOptionsWhere<Order> {
  if (user.role === Role.Driver) {
    return { companyId: user.companyId, assignedDriverId: user.sub };
  }
  return { companyId: user.companyId };
}
