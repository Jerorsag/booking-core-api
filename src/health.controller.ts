import {
  Controller,
  Get,
  InternalServerErrorException,
  Query,
  Req,
} from '@nestjs/common';
import { RequestScope } from './common/decorators/request-scope.decorator';
import { Scope } from './common/context/scope.enum';
import type { RequestWithContext } from './common/context/request-context.types';

@Controller('health')
export class HealthController {
  @Get('system')
  @RequestScope(Scope.SYSTEM)
  getSystemHealth(
    @Req() req: RequestWithContext,
    @Query('fail') fail?: string,
  ) {
    if (fail === 'true') {
      throw new InternalServerErrorException(
        'Forced error to validate failed logs',
      );
    }

    return {
      ok: true,
      scope: Scope.SYSTEM,
      context: req.context ?? null,
    };
  }

  @Get('tenant')
  @RequestScope(Scope.TENANT)
  getTenantHealth(
    @Req() req: RequestWithContext,
    @Query('fail') fail?: string,
  ) {
    if (fail === 'true') {
      throw new InternalServerErrorException(
        'Forced error to validate failed logs',
      );
    }

    return {
      ok: true,
      scope: Scope.TENANT,
      context: req.context ?? null,
    };
  }
}
