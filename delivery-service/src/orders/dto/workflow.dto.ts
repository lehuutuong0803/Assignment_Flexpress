import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { OrderStatus } from '../order-status.enum';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AssignOrderDto {
  /** Keycloak user id (`sub`) of the driver. */
  @IsUUID()
  driverId!: string;
}

export class ChangeStatusDto {
  /** Target status. Allowed transitions are enforced by the state machine (409 otherwise). */
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  /** Required when status is FAILED; optional note otherwise. */
  @ValidateIf(
    (o: ChangeStatusDto) =>
      o.status === OrderStatus.FAILED || o.reason !== undefined,
  )
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'reason is required when status is FAILED' })
  @MaxLength(500)
  reason?: string;

  /** GPS latitude (-90..90). If lat or lng is sent, both are required. */
  @ValidateIf(
    (o: ChangeStatusDto) => o.lat !== undefined || o.lng !== undefined,
  )
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  /** GPS longitude (-180..180). */
  @ValidateIf(
    (o: ChangeStatusDto) => o.lat !== undefined || o.lng !== undefined,
  )
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}

export const POD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type PodContentType = (typeof POD_CONTENT_TYPES)[number];

export class ProofOfDeliveryRequestDto {
  @IsIn(POD_CONTENT_TYPES)
  contentType!: PodContentType;
}

export class ProofOfDeliveryUpload {
  /** Presigned URL: PUT the photo here with the given Content-Type before it expires. */
  uploadUrl!: string;
  method!: 'PUT';
  headers!: Record<string, string>;
  /** Stored on the order; checked with HeadObject before DELIVERED is accepted. */
  objectKey!: string;
  expiresInSeconds!: number;
}

export class OrderStatusEventResponse {
  id!: string;
  fromStatus!: OrderStatus;
  toStatus!: OrderStatus;
  actorId!: string;
  actorRole!: string;
  reason!: string | null;
  lat!: number | null;
  lng!: number | null;
  createdAt!: Date;
}
