import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordService {
  // Costo de hash moderado para equilibrio entre seguridad y rendimiento en entorno SaaS.
  private readonly saltRounds = 12;

  async hashPassword(plainPassword: string): Promise<string> {
    return bcrypt.hash(plainPassword, this.saltRounds);
  }

  async comparePassword(
    plainPassword: string,
    passwordHash: string,
  ): Promise<boolean> {
    return bcrypt.compare(plainPassword, passwordHash);
  }
}
