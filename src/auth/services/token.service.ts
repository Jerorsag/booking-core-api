import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import ms from 'ms';
import type { StringValue } from 'ms';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class TokenService {
  // Hash independiente para refresh tokens, evitando almacenar tokens planos en base de datos.
  private readonly tokenSaltRounds = 10;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async generateAccessToken(
    payload: Omit<JwtPayload, 'tokenType'>,
  ): Promise<string> {
    return this.jwtService.signAsync(
      {
        ...payload,
        tokenType: 'access',
      },
      {
        secret: this.getAccessSecret(),
        expiresIn: this.getAccessExpiresIn(),
      },
    );
  }

  async generateRefreshToken(
    payload: Omit<JwtPayload, 'tokenType'> & { jti: string },
  ): Promise<string> {
    return this.jwtService.signAsync(
      {
        ...payload,
        tokenType: 'refresh',
      },
      {
        secret: this.getRefreshSecret(),
        expiresIn: this.getRefreshExpiresIn(),
      },
    );
  }

  async verifyRefreshToken(token: string): Promise<JwtPayload> {
    return this.jwtService.verifyAsync<JwtPayload>(token, {
      secret: this.getRefreshSecret(),
    });
  }

  async hashToken(token: string): Promise<string> {
    return bcrypt.hash(token, this.tokenSaltRounds);
  }

  async compareTokenHash(token: string, tokenHash: string): Promise<boolean> {
    return bcrypt.compare(token, tokenHash);
  }

  getRefreshTokenExpiryDate(now = new Date()): Date {
    const durationInMs = ms(this.getRefreshExpiresIn());
    return new Date(now.getTime() + durationInMs);
  }

  private getAccessSecret(): string {
    return (
      this.configService.get<string>('JWT_ACCESS_SECRET') ??
      'dev_access_secret_change_me'
    );
  }

  private getRefreshSecret(): string {
    return (
      this.configService.get<string>('JWT_REFRESH_SECRET') ??
      'dev_refresh_secret_change_me'
    );
  }

  private getAccessExpiresIn(): StringValue {
    return (this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
      '15m') as StringValue;
  }

  private getRefreshExpiresIn(): StringValue {
    return (this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ??
      '7d') as StringValue;
  }
}
