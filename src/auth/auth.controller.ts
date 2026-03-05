import {
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { LoginDto } from './dto/login.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SelectOrganizationDto } from './dto/select-organization.dto';
import { VerifyOtpResponseDto } from './dto/verify-otp-response.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { RequestWithContext } from '../common/context/request-context.types';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({
    summary: 'Autenticación por email y password',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiUnauthorizedResponse({ description: 'Credenciales inválidas' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Rotación de refresh token y emisión de nuevo access token',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiUnauthorizedResponse({ description: 'Token inválido' })
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Revoca el refresh token actual sin eliminar histórico',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiOkResponse({ type: LogoutResponseDto })
  @ApiUnauthorizedResponse({ description: 'Token inválido' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto);
  }

  @Post('request-password-reset')
  @ApiOperation({
    summary: 'Solicita código OTP para restablecer contraseña',
  })
  @ApiBody({ type: RequestPasswordResetDto })
  @ApiOkResponse({ type: MessageResponseDto })
  requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    return this.authService.requestPasswordReset(dto);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Restablece contraseña usando OTP',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiBadRequestResponse({ description: 'Código inválido' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('request-otp')
  @ApiOperation({
    summary: 'Solicita OTP phone-first para login/onboarding',
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiOkResponse({ type: MessageResponseDto })
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto);
  }

  @Post('verify-otp')
  @ApiOperation({
    summary: 'Valida OTP y retorna onboarding token o sesión final',
  })
  @ApiBody({ type: VerifyOtpDto })
  @ApiOkResponse({ type: VerifyOtpResponseDto })
  @ApiBadRequestResponse({ description: 'Código inválido' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Post('complete-registration')
  @ApiOperation({
    summary: 'Completa onboarding usando token temporal',
  })
  @ApiBearerAuth()
  @ApiBody({ type: CompleteRegistrationDto })
  @ApiOkResponse({ type: AuthTokensDto })
  completeRegistration(
    @Body() dto: CompleteRegistrationDto,
    @Headers('authorization') authorization?: string,
  ) {
    const token = this.extractBearerToken(authorization);
    return this.authService.completeRegistration(token, dto);
  }

  @Post('select-organization')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Selecciona organización activa y rota sesión',
  })
  @ApiBody({ type: SelectOrganizationDto })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiUnauthorizedResponse({ description: 'Token inválido' })
  selectOrganization(
    @Body() dto: SelectOrganizationDto,
    @Req() req: RequestWithContext,
  ) {
    const actorId = req.user?.sub ?? req.user?.id ?? req.context?.actorId ?? null;
    return this.authService.selectOrganization(actorId, dto);
  }

  @Post('accept-invitation')
  @ApiOperation({
    summary: 'Acepta invitación de organización y crea membership',
  })
  @ApiBody({ type: AcceptInvitationDto })
  @ApiOkResponse({ type: AuthTokensDto })
  @ApiBadRequestResponse({ description: 'Invitación inválida' })
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.authService.acceptInvitation(dto);
  }

  private extractBearerToken(authorization?: string): string {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token inválido');
    }
    return authorization.replace('Bearer ', '').trim();
  }
}
