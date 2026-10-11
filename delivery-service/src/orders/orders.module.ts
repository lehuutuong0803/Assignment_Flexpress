import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module';
import { IdempotencyKey } from './idempotency-key.entity';
import { OrderStatusEvent } from './order-status-event.entity';
import { OrderWorkflowService } from './order-workflow.service';
import { Order } from './order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderStatusEvent, IdempotencyKey]),
    StorageModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrderWorkflowService],
})
export class OrdersModule {}
