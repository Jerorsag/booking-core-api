import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { ListOrganizationsDto } from './dto/list-organizations.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

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
          role: Role.OWNER,
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
}
