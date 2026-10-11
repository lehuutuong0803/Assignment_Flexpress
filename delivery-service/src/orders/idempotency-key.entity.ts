import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * Stored response of a successful POST /orders/:id/status, keyed per user. A retry with the same key
 * and body gets this response back instead of changing the order again.
 */
@Entity('idempotency_keys')
@Index('idx_idempotency_keys_created', ['createdAt'])
export class IdempotencyKey {
  @PrimaryColumn({ type: 'text' })
  key!: string;

  /** Keys are scoped per user, so two clients can never collide on the same key. */
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** SHA-256 of order id + request body: same key with a different request is rejected (422). */
  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;

  @Column({ name: 'status_code', type: 'int' })
  statusCode!: number;

  @Column({ name: 'response_body', type: 'jsonb' })
  responseBody!: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
