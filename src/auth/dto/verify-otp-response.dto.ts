import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyOtpResponseDto {
  @ApiProperty()
  requiresRegistrationCompletion: boolean;

  @ApiPropertyOptional()
  onboardingToken?: string;

  @ApiPropertyOptional()
  accessToken?: string;

  @ApiPropertyOptional()
  refreshToken?: string;
}
