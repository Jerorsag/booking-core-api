import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiPropertyOptional({
    minLength: 8,
    description:
      'Obligatorio solo si el usuario de la invitación no existe aún en el sistema.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/)
  password?: string;
}
