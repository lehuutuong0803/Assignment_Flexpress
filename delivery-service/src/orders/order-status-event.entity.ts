import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Role } from '../auth/auth-user';
import { OrderStatus } from './order-status.enum';
import { Order } from './order.entity';

/** Append-only history: one row per status change, written in the same transaction as the change. */
@Entity('order_status_events')
@Index('idx_order_status_events_order_created', ['orderId', 'createdAt'])
export class OrderStatusEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId!: string;

  @ManyToOne(() => Order, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'order_id' })
  order?: Order;

  @Column({ name: 'from_status', type: 'text' })
  fromStatus!: OrderStatus;

  @Column({ name: 'to_status', type: 'text' })
  toStatus!: OrderStatus;

  /** Keycloak `sub` of whoever made the change. */
  @Column({ name: 'actor_id', type: 'uuid' })
  actorId!: string;

  @Column({ name: 'actor_role', type: 'text' })
  actorRole!: Role;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ type: 'double precision', nullable: true })
  lat!: number | null;

  @Column({ type: 'double precision', nullable: true })
  lng!: number | null;

  /** Server time, never taken from the client. */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
