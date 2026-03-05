import { randomUUID } from 'crypto';
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { OtpCodeType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';

const INVALID_CREDENTIALS_MESSAGE = 'Credenciales inválidas';
const INVALID_TOKEN_MESSAGE = 'Token inválido';
const GENERIC_RESET_REQUEST_MESSAGE =
  'Si el usuario existe, se ha enviado un código de recuperación.';
const INVALID_OTP_MESSAGE = 'Código inválido';
const RESET_PASSWORD_SUCCESS_MESSAGE = 'Contraseña actualizada correctamente';
const MAX_FAILED_ATTEMPTS = 5;
const ACCOUNT_LOCK_MINUTES = 15;
const PASSWORD_RESET_OTP_TTL_MINUTES = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email, mode: 'insensitive' },
      },
      select: {
        id: true,
        systemRole: true,
        passwordHash: true,
        lockUntil: true,
        failedLoginAttempts: true,
      },
    });

    if (!user?.passwordHash || this.isAccountLocked(user.lockUntil)) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const isValidPassword = await this.passwordService.comparePassword(
      dto.password,
      user.passwordHash,
    );

    if (!isValidPassword) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    return this.prisma.$transaction(async (tx) => {
      // Hardening: aun cuando el lock ya haya expirado, lo limpiamos en login exitoso.
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      });

      const refreshJti = randomUUID();
      const accessToken = await this.tokenService.generateAccessToken({
        sub: user.id,
        systemRole: user.systemRole,
      });
      const refreshToken = await this.tokenService.generateRefreshToken({
        sub: user.id,
        systemRole: user.systemRole,
        jti: refreshJti,
      });
      const refreshTokenHash = await this.tokenService.hashToken(refreshToken);

      // Seguridad: sólo persiste hash de refresh token; nunca el token plano.
      await tx.refreshToken.create({
        data: {
          id: refreshJti,
          userId: user.id,
          tokenHash: refreshTokenHash,
          expiresAt: this.tokenService.getRefreshTokenExpiryDate(),
          revokedAt: null,
        },
      });

      return { accessToken, refreshToken };
    });
  }

  async refresh(dto: RefreshTokenDto) {
    const payload = await this.verifyRefreshPayload(dto.refreshToken);
    const refreshJti = payload.jti;
    if (!refreshJti) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    const existingToken = await this.prisma.refreshToken.findFirst({
      where: {
        id: refreshJti,
        userId: payload.sub,
      },
      include: {
        user: {
          select: { id: true, systemRole: true },
        },
      },
    });

    if (
      !existingToken ||
      existingToken.revokedAt ||
      existingToken.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    const isTokenHashValid = await this.tokenService.compareTokenHash(
      dto.refreshToken,
      existingToken.tokenHash,
    );

    if (!isTokenHashValid) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.refreshToken.update({
        where: { id: existingToken.id },
        data: { revokedAt: now },
      });

      const nextJti = randomUUID();
      const accessToken = await this.tokenService.generateAccessToken({
        sub: existingToken.user.id,
        systemRole: existingToken.user.systemRole,
      });
      const nextRefreshToken = await this.tokenService.generateRefreshToken({
        sub: existingToken.user.id,
        systemRole: existingToken.user.systemRole,
        jti: nextJti,
      });
      const nextRefreshTokenHash =
        await this.tokenService.hashToken(nextRefreshToken);

      // Rotación: cada refresh invalida el token usado y emite uno nuevo.
      await tx.refreshToken.create({
        data: {
          id: nextJti,
          userId: existingToken.user.id,
          tokenHash: nextRefreshTokenHash,
          expiresAt: this.tokenService.getRefreshTokenExpiryDate(now),
          revokedAt: null,
        },
      });

      return {
        accessToken,
        refreshToken: nextRefreshToken,
      };
    });
  }

  async logout(dto: RefreshTokenDto) {
    const payload = await this.verifyRefreshPayload(dto.refreshToken);
    if (!payload.jti) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    await this.prisma.refreshToken.updateMany({
      where: {
        id: payload.jti,
        userId: payload.sub,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return { success: true };
  }

  async requestPasswordReset(dto: RequestPasswordResetDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email, mode: 'insensitive' },
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
      },
    });

    // Respuesta siempre genérica para evitar user enumeration.
    if (!user?.passwordHash) {
      return { message: GENERIC_RESET_REQUEST_MESSAGE };
    }

    const otpCode = this.generateNumericOtp();
    const otpCodeHash = await this.passwordService.hashPassword(otpCode);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Recomendado: invalidar OTPs previos del mismo tipo para reducir superficie de ataque.
      await tx.otpCode.updateMany({
        where: {
          userId: user.id,
          type: OtpCodeType.PASSWORD_RESET,
          consumed: false,
        },
        data: {
          consumed: true,
        },
      });

      await tx.otpCode.create({
        data: {
          userId: user.id,
          type: OtpCodeType.PASSWORD_RESET,
          codeHash: otpCodeHash,
          expiresAt: new Date(
            now.getTime() + PASSWORD_RESET_OTP_TTL_MINUTES * 60 * 1000,
          ),
          attempts: 0,
          consumed: false,
        },
      });
    });

    // Simulación temporal de envío por email; en producción debe ir por proveedor externo.
    console.log(`[SIMULACION EMAIL] Reset OTP para ${user.email}: ${otpCode}`);

    return { message: GENERIC_RESET_REQUEST_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (!this.isPasswordStrong(dto.newPassword)) {
      throw new BadRequestException(INVALID_OTP_MESSAGE);
    }

    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email, mode: 'insensitive' },
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw new BadRequestException(INVALID_OTP_MESSAGE);
    }

    const activeOtpCode = await this.prisma.otpCode.findFirst({
      where: {
        userId: user.id,
        type: OtpCodeType.PASSWORD_RESET,
        consumed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeOtpCode) {
      throw new BadRequestException(INVALID_OTP_MESSAGE);
    }

    const otpIsValid = await this.passwordService.comparePassword(
      dto.otpCode,
      activeOtpCode.codeHash,
    );

    if (!otpIsValid) {
      await this.prisma.otpCode.update({
        where: { id: activeOtpCode.id },
        data: {
          attempts: { increment: 1 },
        },
      });
      throw new BadRequestException(INVALID_OTP_MESSAGE);
    }

    const newPasswordHash = await this.passwordService.hashPassword(
      dto.newPassword,
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newPasswordHash,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      });

      await tx.otpCode.update({
        where: { id: activeOtpCode.id },
        data: {
          consumed: true,
        },
      });

      // Se revocan todas las sesiones para cortar acceso de tokens potencialmente comprometidos.
      await this.revokeAllUserRefreshTokens(user.id, tx);
    });

    // No emitimos tokens aquí para obligar un login explícito posterior al cambio de credencial.
    return { message: RESET_PASSWORD_SUCCESS_MESSAGE };
  }

  private async verifyRefreshPayload(token: string) {
    try {
      const payload = await this.tokenService.verifyRefreshToken(token);
      if (payload.tokenType !== 'refresh') {
        throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
      }
      return payload;
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }
  }

  private isAccountLocked(lockUntil: Date | null): boolean {
    return Boolean(lockUntil && lockUntil > new Date());
  }

  private async registerFailedAttempt(
    userId: string,
    currentFailedAttempts: number,
  ): Promise<void> {
    const nextFailedAttempts = currentFailedAttempts + 1;
    const mustLockAccount = nextFailedAttempts >= MAX_FAILED_ATTEMPTS;
    const lockUntil = mustLockAccount
      ? new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60 * 1000)
      : null;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: nextFailedAttempts,
        lockUntil,
      },
    });
  }

  private generateNumericOtp(): string {
    const code = Math.floor(100000 + Math.random() * 900000);
    return String(code);
  }

  private isPasswordStrong(password: string): boolean {
    return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password);
  }

  private async revokeAllUserRefreshTokens(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const now = new Date();
    await tx.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
      },
    });
  }
}
