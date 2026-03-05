import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthTokensDto } from './dto/auth-tokens.dto';
import { LoginDto } from './dto/login.dto';
import { MessageResponseDto } from './dto/message-response.dto';
import { LogoutResponseDto } from './dto/logout-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

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
}
