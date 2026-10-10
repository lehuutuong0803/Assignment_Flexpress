import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Deliberately has no companyId or createdBy: those come from the token. With the global
 * ValidationPipe (whitelist + forbidNonWhitelisted), sending them is rejected with 400.
 */
export class CreateOrderDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  pickupAddress!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  deliveryAddress!: string;
}
