import { randomUUID } from 'crypto';
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationRole, OtpCodeType, Prisma, SystemRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SelectOrganizationDto } from './dto/select-organization.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';

const INVALID_CREDENTIALS_MESSAGE = 'Credenciales inválidas';
const INVALID_TOKEN_MESSAGE = 'Token inválido';
const GENERIC_OTP_REQUEST_MESSAGE =
  'Si el número existe, se ha enviado un código de verificación.';
const GENERIC_RESET_REQUEST_MESSAGE =
  'Si el usuario existe, se ha enviado un código de recuperación.';
const INVALID_OTP_MESSAGE = 'Código inválido';
const INVALID_INVITATION_MESSAGE = 'Invitación inválida';
const INVALID_ORGANIZATION_MESSAGE = 'Organización inválida';
const INVALID_REGISTRATION_MESSAGE = 'Datos de registro inválidos';
const RESET_PASSWORD_SUCCESS_MESSAGE = 'Contraseña actualizada correctamente';
const MAX_FAILED_ATTEMPTS = 5;
const ACCOUNT_LOCK_MINUTES = 15;
const LOGIN_OTP_TTL_MINUTES = 5;
const PASSWORD_RESET_OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;
const LOGIN_OTP_TYPE = 'LOGIN_OTP' as OtpCodeType;

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

  async requestOtp(dto: RequestOtpDto) {
    const normalizedPhone = this.normalizePhone(dto.phone);
    const now = new Date();
    const otpCode = this.generateNumericOtp();
    const otpCodeHash = await this.passwordService.hashPassword(otpCode);

    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { phone: normalizedPhone },
        update: {},
        create: {
          phone: normalizedPhone,
          systemRole: SystemRole.USER,
          isPhoneVerified: false,
        },
        select: { id: true, phone: true },
      });

      // Se invalida cualquier OTP de login previo para reducir ventanas de ataque.
      await tx.otpCode.updateMany({
        where: {
          userId: user.id,
          type: LOGIN_OTP_TYPE,
          consumed: false,
        },
        data: { consumed: true },
      });

      await tx.otpCode.create({
        data: {
          userId: user.id,
          type: LOGIN_OTP_TYPE,
          codeHash: otpCodeHash,
          expiresAt: new Date(now.getTime() + LOGIN_OTP_TTL_MINUTES * 60 * 1000),
          attempts: 0,
          consumed: false,
        },
      });

      // Simulación temporal de envío (en producción debe pasar por proveedor WhatsApp/SMS).
      console.log(`[SIMULACION OTP] Login OTP para ${user.phone}: ${otpCode}`);
    });

    // Mensaje genérico para evitar enumeración de usuarios.
    return { message: GENERIC_OTP_REQUEST_MESSAGE };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const normalizedPhone = this.normalizePhone(dto.phone);
    const user = await this.prisma.user.findUnique({
      where: { phone: normalizedPhone },
      select: {
        id: true,
        systemRole: true,
        email: true,
        passwordHash: true,
        memberships: {
          select: { organizationId: true },
        },
      },
    });

    if (!user) {
      throw new BadRequestException(INVALID_OTP_MESSAGE);
    }

    const otp = await this.prisma.otpCode.findFirst({
      where: {
        userId: user.id,
        type: LOGIN_OTP_TYPE,
        consumed: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new BadRequestException(INVALID_OTP_MESSAGE);
    }

    const otpIsValid = await this.passwordService.comparePassword(
      dto.otpCode,
      otp.codeHash,
    );

    if (!otpIsValid) {
      const nextAttempts = otp.attempts + 1;
      await this.prisma.otpCode.update({
        where: { id: otp.id },
        data: {
          attempts: nextAttempts,
          ...(nextAttempts >= MAX_OTP_ATTEMPTS ? { consumed: true } : {}),
        },
      });
      throw new BadRequestException(INVALID_OTP_MESSAGE);
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.otpCode.update({
        where: { id: otp.id },
        data: { consumed: true },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { isPhoneVerified: true },
      });

      const hasCompletedProfile = Boolean(user.email && user.passwordHash);
      const hasMembership = user.memberships.length > 0;

      if (!hasCompletedProfile || !hasMembership) {
        const onboardingToken = await this.tokenService.generateOnboardingToken({
          sub: user.id,
          systemRole: user.systemRole,
        });

        return {
          requiresRegistrationCompletion: true,
          onboardingToken,
        };
      }

      const preferredOrganizationId =
        user.memberships.length === 1 ? user.memberships[0].organizationId : undefined;
      const tokens = await this.issueSessionTokens(tx, {
        userId: user.id,
        systemRole: user.systemRole,
        organizationId: preferredOrganizationId,
      });

      return {
        requiresRegistrationCompletion: false,
        ...tokens,
      };
    });
  }

  async completeRegistration(onboardingToken: string, dto: CompleteRegistrationDto) {
    const payload = await this.verifyOnboardingPayload(onboardingToken);
    await this.ensurePasswordStrength(dto.password);
    await this.ensureEmailAvailableForUser(dto.email, payload.sub);

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          phone: true,
          systemRole: true,
          memberships: { select: { organizationId: true, role: true } },
        },
      });

      if (!user) {
        throw new NotFoundException('Usuario no encontrado');
      }

      const passwordHash = await this.passwordService.hashPassword(dto.password);

      await tx.user.update({
        where: { id: user.id },
        data: {
          email: dto.email.trim().toLowerCase(),
          passwordHash,
        },
      });

      const existingOwnerMembership = user.memberships.find((membership) => membership.role === 'OWNER');
      let organizationId = existingOwnerMembership?.organizationId;

      if (!organizationId) {
        const organization = await tx.organization.create({
          data: {
            name: dto.organizationName,
            email: dto.email.trim().toLowerCase(),
            // En onboarding phone-first reutilizamos el teléfono verificado como base de contacto.
            phone: user.phone ?? 'PENDING_PHONE',
          },
        });
        organizationId = organization.id;

        await tx.organizationMember.create({
          data: {
            organizationId,
            userId: user.id,
            role: OrganizationRole.OWNER,
          },
        });
      }

      const tokens = await this.issueSessionTokens(tx, {
        userId: user.id,
        systemRole: user.systemRole,
        organizationId,
      });

      return {
        organizationId,
        ...tokens,
      };
    });
  }

  async selectOrganization(actorId: string | null, dto: SelectOrganizationDto) {
    if (!actorId) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        userId: actorId,
        organizationId: dto.organizationId,
      },
      select: { id: true },
    });

    if (!membership) {
      throw new ForbiddenException(INVALID_ORGANIZATION_MESSAGE);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true, systemRole: true },
    });

    if (!user) {
      throw new UnauthorizedException(INVALID_TOKEN_MESSAGE);
    }

    return this.prisma.$transaction(async (tx) =>
      this.issueSessionTokens(tx, {
        userId: user.id,
        systemRole: user.systemRole,
        organizationId: dto.organizationId,
      }),
    );
  }

  async acceptInvitation(dto: AcceptInvitationDto) {
    const invitationId = this.extractInvitationId(dto.token);

    const invitation = await this.prisma.invitation.findFirst({
      where: {
        id: invitationId,
        acceptedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        email: true,
        organizationId: true,
        role: true,
        tokenHash: true,
      },
    });

    if (!invitation) {
      throw new BadRequestException(INVALID_INVITATION_MESSAGE);
    }

    const tokenMatches = await this.tokenService.compareTokenHash(
      dto.token,
      invitation.tokenHash,
    );

    if (!tokenMatches) {
      throw new BadRequestException(INVALID_INVITATION_MESSAGE);
    }

    return this.prisma.$transaction(async (tx) => {
      const freshInvitation = await tx.invitation.findFirst({
        where: {
          id: invitation.id,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          email: true,
          organizationId: true,
          role: true,
        },
      });

      if (!freshInvitation) {
        throw new BadRequestException(INVALID_INVITATION_MESSAGE);
      }

      const normalizedEmail = freshInvitation.email.trim().toLowerCase();
      const existingUser = await tx.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
        select: { id: true, systemRole: true },
      });

      let userId = existingUser?.id;
      let userSystemRole = existingUser?.systemRole ?? SystemRole.USER;

      if (!existingUser) {
        if (!dto.password) {
          throw new BadRequestException(
            'La contraseña es obligatoria para aceptar esta invitación.',
          );
        }

        await this.ensurePasswordStrength(dto.password);
        const passwordHash = await this.passwordService.hashPassword(dto.password);

        const createdUser = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            systemRole: SystemRole.USER,
            isEmailVerified: false,
            isPhoneVerified: false,
          },
          select: { id: true, systemRole: true },
        });

        userId = createdUser.id;
        userSystemRole = createdUser.systemRole;
      }

      if (!userId) {
        throw new BadRequestException(INVALID_INVITATION_MESSAGE);
      }

      const existingMembership = await tx.organizationMember.findFirst({
        where: {
          organizationId: freshInvitation.organizationId,
          userId,
        },
        select: { id: true },
      });

      if (existingMembership) {
        throw new ConflictException(
          'El usuario ya está vinculado a esta organización.',
        );
      }

      await tx.organizationMember.create({
        data: {
          organizationId: freshInvitation.organizationId,
          userId,
          role: freshInvitation.role,
        },
      });

      await tx.invitation.update({
        where: { id: freshInvitation.id },
        data: { acceptedAt: new Date() },
      });

      // Se emiten tokens con organizationId activa para mantener contexto tenant inmediato.
      return this.issueSessionTokens(tx, {
        userId,
        systemRole: userSystemRole,
        organizationId: freshInvitation.organizationId,
      });
    });
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
    await this.ensurePasswordStrength(dto.newPassword);

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

  private async verifyOnboardingPayload(token: string) {
    try {
      const payload = await this.tokenService.verifyOnboardingToken(token);
      if (payload.tokenType !== 'onboarding') {
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

  private async ensurePasswordStrength(password: string): Promise<void> {
    if (!this.isPasswordStrong(password)) {
      throw new BadRequestException(
        'La contraseña debe tener mínimo 8 caracteres, una letra y un número.',
      );
    }
  }

  private async ensureEmailAvailableForUser(
    email: string,
    userId: string,
  ): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.prisma.user.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        NOT: { id: userId },
      },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException(INVALID_REGISTRATION_MESSAGE);
    }
  }

  private normalizePhone(phone: string): string {
    return phone.trim();
  }

  private extractInvitationId(token: string): string {
    const [invitationId] = token.split('.');
    if (!invitationId) {
      throw new BadRequestException(INVALID_INVITATION_MESSAGE);
    }

    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidV4Regex.test(invitationId)) {
      throw new BadRequestException(INVALID_INVITATION_MESSAGE);
    }

    return invitationId;
  }

  private async issueSessionTokens(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      systemRole: SystemRole;
      organizationId?: string;
    },
  ) {
    const refreshJti = randomUUID();
    const accessToken = await this.tokenService.generateAccessToken({
      sub: input.userId,
      systemRole: input.systemRole,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    });
    const refreshToken = await this.tokenService.generateRefreshToken({
      sub: input.userId,
      systemRole: input.systemRole,
      jti: refreshJti,
      ...(input.organizationId ? { organizationId: input.organizationId } : {}),
    });
    const refreshTokenHash = await this.tokenService.hashToken(refreshToken);

    await tx.refreshToken.create({
      data: {
        id: refreshJti,
        userId: input.userId,
        tokenHash: refreshTokenHash,
        expiresAt: this.tokenService.getRefreshTokenExpiryDate(),
      },
    });

    return { accessToken, refreshToken };
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
