import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStatusEventsAndIdempotencyKeys1791698087607 implements MigrationInterface {
  name = 'AddStatusEventsAndIdempotencyKeys1791698087607';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "idempotency_keys" ("key" text NOT NULL, "user_id" uuid NOT NULL, "request_hash" text NOT NULL, "status_code" integer NOT NULL, "response_body" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_392b1af86f210d98d3f0c764728" PRIMARY KEY ("key", "user_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_idempotency_keys_created" ON "idempotency_keys" ("created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "order_status_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "order_id" uuid NOT NULL, "from_status" text NOT NULL, "to_status" text NOT NULL, "actor_id" uuid NOT NULL, "actor_role" text NOT NULL, "reason" text, "lat" double precision, "lng" double precision, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_cee8187701a1f5ca1d3780f89dc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_order_status_events_order_created" ON "order_status_events" ("order_id", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "order_status_events" ADD CONSTRAINT "FK_4dd918631de3ec45cb4fa4d2d83" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_status_events" DROP CONSTRAINT "FK_4dd918631de3ec45cb4fa4d2d83"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_order_status_events_order_created"`,
    );
    await queryRunner.query(`DROP TABLE "order_status_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_idempotency_keys_created"`,
    );
    await queryRunner.query(`DROP TABLE "idempotency_keys"`);
  }
}
