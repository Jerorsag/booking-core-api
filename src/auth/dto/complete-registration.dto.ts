import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches, MinLength } from 'class-validator';

export class CompleteRegistrationDto {
  @ApiProperty({ example: 'owner@barber-alpha.com' })
  @IsEmail()
  email: string;

  @ApiProperty({
    minLength: 8,
    description: 'Mínimo 8 caracteres con al menos 1 letra y 1 número.',
  })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/)
  password: string;

  @ApiProperty({ example: 'BarberShop Alpha' })
  @IsString()
  @Length(2, 120)
  organizationName: string;
}
