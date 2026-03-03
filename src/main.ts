import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger'

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
  .setTitle('Appointments SaaS API')
  .setDescription(`
    Multi-tenant SaaS platform for service-based businesses.

    Core Features:
    - Organization management
    - Multi-branch support
    - Staff & role management
    - Service pricing per branch
    - Advanced scheduling engine
    - WhatsApp automated booking
    - SaaS subscription system

    Architecture:
    - NestJS
    - Prisma ORM
    - PostgreSQL
    - JWT Authentication
    - Multi-tenant isolation
      `)
  .setVersion('0.1')
  .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
