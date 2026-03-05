import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  OrganizationRole,
  Prisma,
  SystemRole,
} from '@prisma/client';
import { PasswordService } from '../auth/services/password.service';
import { TokenService } from '../auth/services/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { ListOrganizationsDto } from './dto/list-organizations.dto';
import { RegisterOrganizationDto } from './dto/register-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  async registerOrganization(dto: RegisterOrganizationDto) {
    const normalizedEmail = dto.ownerEmail.trim().toLowerCase();
    await this.ensurePasswordStrong(dto.ownerPassword);
    await this.ensureEmailIsUnique(normalizedEmail);
    await this.ensureOrganizationNameIsUnique(dto.organizationName);

    return this.prisma.$transaction(async (tx) => {
      const ownerPasswordHash = await this.passwordService.hashPassword(
        dto.ownerPassword,
      );

      const owner = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash: ownerPasswordHash,
          systemRole: SystemRole.USER,
          isEmailVerified: false,
          isPhoneVerified: false,
        },
      });

      const organization = await tx.organization.create({
        data: {
          name: dto.organizationName,
          email: normalizedEmail,
          // Se deja un valor temporal para no forzar captura de teléfono en esta fase.
          phone: 'PENDING_PHONE',
        },
      });

      await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: owner.id,
          role: OrganizationRole.OWNER,
        },
      });

      const refreshJti = randomUUID();
      const accessToken = await this.tokenService.generateAccessToken({
        sub: owner.id,
        systemRole: owner.systemRole,
        organizationId: organization.id,
      });
      const refreshToken = await this.tokenService.generateRefreshToken({
        sub: owner.id,
        systemRole: owner.systemRole,
        organizationId: organization.id,
        jti: refreshJti,
      });
      const refreshTokenHash = await this.tokenService.hashToken(refreshToken);

      // Seguridad: se guarda únicamente el hash del refresh token para evitar filtración útil.
      await tx.refreshToken.create({
        data: {
          id: refreshJti,
          userId: owner.id,
          tokenHash: refreshTokenHash,
          expiresAt: this.tokenService.getRefreshTokenExpiryDate(),
          revokedAt: null,
        },
      });

      return {
        organizationId: organization.id,
        ownerUserId: owner.id,
        accessToken,
        refreshToken,
      };
    });
  }

  async createStaff(
    organizationId: string,
    dto: CreateStaffDto,
    actorId: string | null,
  ) {
    if (!actorId) {
      throw new UnauthorizedException('No se pudo identificar el usuario actor.');
    }

    const normalizedEmail = dto.email.trim().toLowerCase();

    const [organization, ownerMembership] = await Promise.all([
      this.prisma.organization.findFirst({
        where: { id: organizationId, deletedAt: null },
        select: { id: true },
      }),
      this.prisma.organizationMember.findFirst({
        where: {
          organizationId,
          userId: actorId,
          role: OrganizationRole.OWNER,
        },
        select: { id: true },
      }),
    ]);

    if (!organization) {
      throw new NotFoundException('La organización solicitada no existe.');
    }

    if (!ownerMembership) {
      throw new ForbiddenException(
        'Acceso denegado: solo un OWNER puede crear usuarios STAFF.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
        select: { id: true, email: true },
      });

      let staffUserId = existingUser?.id;
      let staffEmail = existingUser?.email ?? normalizedEmail;

      if (!existingUser) {
        if (!dto.password) {
          throw new BadRequestException(
            'La contraseña es obligatoria cuando el usuario STAFF no existe.',
          );
        }

        await this.ensurePasswordStrong(dto.password);
        const passwordHash = await this.passwordService.hashPassword(dto.password);

        const createdUser = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash,
            systemRole: SystemRole.USER,
            isEmailVerified: false,
            isPhoneVerified: false,
          },
          select: { id: true, email: true },
        });

        staffUserId = createdUser.id;
        staffEmail = createdUser.email ?? normalizedEmail;
      }

      if (!staffUserId) {
        throw new BadRequestException(
          'No se pudo resolver el usuario STAFF para la operación.',
        );
      }

      // Multi-tenant: se permite mismo usuario en múltiples orgs, pero no duplicado en la misma.
      const existingMembership = await tx.organizationMember.findFirst({
        where: {
          organizationId,
          userId: staffUserId,
        },
        select: { id: true },
      });

      if (existingMembership) {
        throw new ConflictException(
          'El usuario ya está vinculado a esta organización.',
        );
      }

      const membership = await tx.organizationMember.create({
        data: {
          organizationId,
          userId: staffUserId,
          role: OrganizationRole.STAFF,
        },
      });

      // No emitimos tokens automáticamente para mantener alta por invitación/controlada.
      return {
        userId: staffUserId,
        email: staffEmail,
        organizationId,
        membershipId: membership.id,
        role: membership.role,
      };
    });
  }

  async createOrganization(
    dto: CreateOrganizationDto,
    actorId: string | null,
  ) {
    if (!actorId) {
      throw new UnauthorizedException(
        'No se pudo identificar el usuario creador de la organización.',
      );
    }

    const creator = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { id: true },
    });

    if (!creator) {
      throw new NotFoundException(
        'El usuario creador no existe en el sistema.',
      );
    }

    await this.ensureOrganizationUniqueness(dto);

    // Self-service SaaS: se crea Organization y membresía OWNER en una sola transacción.
    const organization = await this.prisma.$transaction(async (tx) => {
      const createdOrganization = await tx.organization.create({
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          ...(dto.settings
            ? { settings: dto.settings as Prisma.InputJsonValue }
            : {}),
        },
      });

      await tx.organizationMember.create({
        data: {
          organizationId: createdOrganization.id,
          userId: actorId,
          role: OrganizationRole.OWNER,
        },
      });

      return createdOrganization;
    });

    return organization;
  }

  async getOrganizationById(id: string) {
    const organization = await this.prisma.organization.findFirst({
      where: {
        id,
        deletedAt: null,
      },
    });

    if (!organization) {
      throw new NotFoundException('La organización solicitada no existe.');
    }

    return organization;
  }

  async listOrganizations(query: ListOrganizationsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const searchTerm = query.search?.trim();
    const searchFilter: Prisma.OrganizationWhereInput | undefined = searchTerm
      ? {
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { email: { contains: searchTerm, mode: 'insensitive' } },
          ],
        }
      : undefined;

    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      ...(searchFilter ?? {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.organization.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.organization.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async ensureOrganizationUniqueness(
    dto: CreateOrganizationDto,
  ): Promise<void> {
    const existing = await this.prisma.organization.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { name: { equals: dto.name, mode: 'insensitive' } },
          { email: { equals: dto.email, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, email: true },
    });

    if (!existing) {
      return;
    }

    if (existing.name.toLowerCase() === dto.name.toLowerCase()) {
      throw new ConflictException(
        'Ya existe una organización activa con el mismo nombre.',
      );
    }

    throw new ConflictException(
      'Ya existe una organización activa con el mismo correo.',
    );
  }

  private async ensureOrganizationNameIsUnique(name: string): Promise<void> {
    const existing = await this.prisma.organization.findFirst({
      where: {
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'Ya existe una organización activa con el mismo nombre.',
      );
    }
  }

  private async ensureEmailIsUnique(email: string): Promise<void> {
    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('Ya existe un usuario con ese correo.');
    }
  }

  private async ensurePasswordStrong(password: string): Promise<void> {
    const isStrong = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password);
    if (!isStrong) {
      throw new BadRequestException(
        'La contraseña debe tener mínimo 8 caracteres, una letra y un número.',
      );
    }
  }
}
