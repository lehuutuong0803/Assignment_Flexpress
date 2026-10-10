import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrders1791668047578 implements MigrationInterface {
  name = 'CreateOrders1791668047578';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "orders" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "company_id" uuid NOT NULL, "pickup_address" text NOT NULL, "delivery_address" text NOT NULL, "assigned_driver_id" uuid, "status" text NOT NULL DEFAULT 'CREATED', "pod_object_key" text, "created_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_orders_status" CHECK ("status" IN ('CREATED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED')), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_orders_driver_created" ON "orders" ("assigned_driver_id", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_orders_company_status_created" ON "orders" ("company_id", "status", "created_at", "id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_orders_company_created" ON "orders" ("company_id", "created_at", "id") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_orders_company_created"`);
    await queryRunner.query(
      `DROP INDEX "public"."idx_orders_company_status_created"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_orders_driver_created"`);
    await queryRunner.query(`DROP TABLE "orders"`);
  }
}
