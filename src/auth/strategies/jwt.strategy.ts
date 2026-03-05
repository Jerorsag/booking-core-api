import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Se usa secreto de access token, ya que esta estrategia protege rutas autenticadas estándar.
      secretOrKey:
        configService.get<string>('JWT_ACCESS_SECRET') ??
        'dev_access_secret_change_me',
    });
  }

  async validate(payload: JwtPayload) {
    // Este objeto se adjunta a req.user automáticamente por Passport.
    return {
      sub: payload.sub,
      id: payload.sub,
      systemRole: payload.systemRole,
      organizationId: payload.organizationId,
      jti: payload.jti,
      tokenType: payload.tokenType,
    };
  }
}
