import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Scope } from '../common/context/scope.enum';
import type { RequestWithContext } from '../common/context/request-context.types';
import { RequestScope } from '../common/decorators/request-scope.decorator';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { ListOrganizationsDto } from './dto/list-organizations.dto';
import { OrganizationsService } from './organizations.service';

@ApiTags('Organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @RequestScope(Scope.SYSTEM)
  @ApiOperation({
    summary: 'Crear organización en modo self-service',
  })
  createOrganization(
    @Body() dto: CreateOrganizationDto,
    @Req() req: RequestWithContext,
  ) {
    return this.organizationsService.createOrganization(
      dto,
      req.context?.actorId ?? null,
    );
  }

  @Get()
  @RequestScope(Scope.SYSTEM)
  @ApiOperation({
    summary: 'Listar organizaciones (solo super-admin)',
  })
  listOrganizations(
    @Query() query: ListOrganizationsDto,
    @Req() req: RequestWithContext,
  ) {
    this.assertSuperAdmin(req);
    return this.organizationsService.listOrganizations(query);
  }

  @Get(':id')
  @RequestScope(Scope.SYSTEM)
  @ApiOperation({
    summary: 'Obtener organización por id',
  })
  getOrganizationById(@Param('id', ParseUUIDPipe) id: string) {
    return this.organizationsService.getOrganizationById(id);
  }

  private assertSuperAdmin(req: RequestWithContext): void {
    const roleCandidates = new Set<string>();
    if (req.user?.role) {
      roleCandidates.add(req.user.role);
    }
    if (req.user?.systemRole) {
      roleCandidates.add(req.user.systemRole);
    }
    if (req.user?.roles?.length) {
      for (const role of req.user.roles) {
        roleCandidates.add(role);
      }
    }

    for (const role of roleCandidates) {
      if (role.toUpperCase() === 'SUPER_ADMIN') {
        return;
      }
    }

    // Este endpoint vive en System Scope y requiere privilegio global explícito.
    throw new ForbiddenException(
      'Acceso denegado: se requiere rol SUPER_ADMIN para listar organizaciones.',
    );
  }
}
