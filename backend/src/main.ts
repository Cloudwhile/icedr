import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
    .setTitle('ICEDR')
    .setDescription(
      'NestJS monolith for workspace drive, files, shares, and audit logs',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, documentConfig);
  SwaggerModule.setup('api/docs', app, document);
  configureFrontendStaticAssets(app);

  await app.listen(port, host);
}
void bootstrap();

function configureFrontendStaticAssets(app: NestExpressApplication) {
  const frontendDistDir =
    process.env.FRONTEND_DIST_DIR?.trim() || join(process.cwd(), 'public');
  const indexPath = join(frontendDistDir, 'index.html');
  if (!existsSync(indexPath)) return;

  app.useStaticAssets(frontendDistDir, {
    index: false,
    maxAge: '1y',
  });

  const server = app.getHttpAdapter().getInstance();
  server.get(/^(?!\/api(?:\/|$)).*/, (_request: Request, response: Response) =>
    response.sendFile(indexPath),
  );
}
