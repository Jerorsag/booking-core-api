import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // Guard reutilizable para rutas privadas; mantiene la validación en la estrategia.
  override canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  override handleRequest<TUser = unknown>(err: unknown, user: TUser | false) {
    if (err || !user) {
      throw new UnauthorizedException('Token JWT inválido o expirado.');
    }

    // Se retorna user para que Nest lo inyecte en req.user y el RequestContext lo aproveche.
    return user;
  }
}
