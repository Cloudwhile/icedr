import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>('api.port') ?? 3001;
  const host = config.get<string>('api.host') ?? '127.0.0.1';

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.get<string>('api.corsOrigin') ?? 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  const documentConfig = new DocumentBuilder()
    .setTitle('ICEDR API')
    .setDescription(
      'NestJS monolith for workspace drive, files, shares, and audit logs',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, documentConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port, host);
}
void bootstrap();
