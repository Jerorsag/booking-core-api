import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({
    example: '+5215555555555',
  })
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  phone: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{6}$/)
  otpCode: string;
}
