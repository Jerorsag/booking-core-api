import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsObject, IsOptional, IsString, Length } from 'class-validator';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Acme Studio' })
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({ example: 'contact@acme.studio' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '+5215555555555' })
  @IsString()
  @Length(6, 30)
  phone: string;

  @ApiPropertyOptional({
    example: { locale: 'es-MX', timezone: 'America/Mexico_City' },
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
