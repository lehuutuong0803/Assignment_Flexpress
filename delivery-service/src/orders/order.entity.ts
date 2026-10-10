import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderStatus } from './order-status.enum';

const statusList = Object.values(OrderStatus)
  .map((s) => `'${s}'`)
  .join(', ');

// Each index serves one list query; `id` is the tie-breaker of ORDER BY created_at DESC, id DESC.
@Entity('orders')
@Check('chk_orders_status', `"status" IN (${statusList})`)
@Index('idx_orders_company_created', ['companyId', 'createdAt', 'id'])
@Index('idx_orders_company_status_created', [
  'companyId',
  'status',
  'createdAt',
  'id',
])
@Index('idx_orders_driver_created', ['assignedDriverId', 'createdAt', 'id'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Always taken from the creator's token, never from request input. */
  @Column({ name: 'company_id', type: 'uuid' })
  companyId!: string;

  @Column({ name: 'pickup_address', type: 'text' })
  pickupAddress!: string;

  @Column({ name: 'delivery_address', type: 'text' })
  deliveryAddress!: string;

  /** Keycloak `sub` of the assigned driver. */
  @Column({ name: 'assigned_driver_id', type: 'uuid', nullable: true })
  assignedDriverId!: string | null;

  // text + CHECK instead of a Postgres enum: values can be added or removed in a plain migration.
  @Column({ type: 'text', default: OrderStatus.CREATED })
  status!: OrderStatus;

  @Column({ name: 'pod_object_key', type: 'text', nullable: true })
  podObjectKey!: string | null;

  /** Keycloak `sub` of the dispatcher who created the order. */
  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
