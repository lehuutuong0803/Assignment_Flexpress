import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { OrderStatus } from '../order-status.enum';

/** Query string of GET /orders. Values arrive as strings, so numbers are converted with @Type. */
export class ListOrdersQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  /** Inclusive lower bound on createdAt (ISO 8601). */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  /** Exclusive upper bound on createdAt (ISO 8601). */
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
