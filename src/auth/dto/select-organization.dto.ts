import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SelectOrganizationDto {
  @ApiProperty()
  @IsUUID()
  organizationId: string;
}
