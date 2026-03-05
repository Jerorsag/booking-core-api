import { ApiProperty } from '@nestjs/swagger';
import { OrganizationRole } from '@prisma/client';
import { IsEmail, IsEnum } from 'class-validator';

export class CreateInvitationDto {
  @ApiProperty({ example: 'staff@acme.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ enum: OrganizationRole, example: OrganizationRole.STAFF })
  @IsEnum(OrganizationRole)
  role: OrganizationRole;
}
