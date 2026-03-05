import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({
    example: '+5215555555555',
    description: 'Número en formato internacional.',
  })
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  phone: string;
}
