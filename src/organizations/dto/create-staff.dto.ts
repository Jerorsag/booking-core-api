import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class CreateStaffDto {
  @ApiProperty({ example: 'staff@acme.com' })
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
}
