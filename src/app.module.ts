import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { StructuredLoggerService } from './common/logging/structured-logger.service';
import { HealthController } from './health.controller';
import { OrganizationsModule } from './organizations/organizations.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    OrganizationsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, StructuredLoggerService],
})
export class AppModule {}
