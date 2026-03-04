import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    // Validación temprana para detectar configuración faltante al arrancar.
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL no está definida. Configúrala antes de iniciar la aplicación.',
      );
    }

    // Prisma v7 usa adapter para conexión directa; aquí inyectamos DATABASE_URL.
    const adapter = new PrismaPg({ connectionString: databaseUrl });
    super({ adapter });
  }

  // Se ejecuta al levantar el módulo para abrir una conexión reutilizable a la base de datos.
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  // Se ejecuta al cerrar el módulo para liberar conexiones y evitar fugas de recursos.
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
