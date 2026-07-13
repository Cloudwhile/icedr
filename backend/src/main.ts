import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { shouldExposeApiDocs } from './common/security/api-exposure-policy';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>('api.port') ?? 3001;
  const host = config.get<string>('api.host') ?? '127.0.0.1';

  app.set('trust proxy', config.get<boolean>('api.trustProxy') ?? false);
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

  if (shouldExposeApiDocs(config.get<boolean>('app.production') ?? false)) {
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
  }
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
  server.get(
    /.*/,
    (request: Request, response: Response, next: NextFunction) => {
      const path = getRequestPath(request);
      if (isApiRequestPath(path)) {
        next();
        return;
      }
      if (isUnprefixedApiRequestPath(path)) {
        response.status(404).json({
          statusCode: 404,
          message: 'Not Found',
          error: 'Not Found',
          code: 'API_ROUTE_NOT_FOUND',
        });
        return;
      }
      if (!requestAcceptsHtml(request)) {
        next();
        return;
      }
      response.sendFile(indexPath);
    },
  );
}

function getRequestPath(request: Request) {
  return request.path || request.url.split('?', 1)[0] || '/';
}

function isApiRequestPath(path: string) {
  return path === '/api' || path.startsWith('/api/');
}

const unprefixedApiRouteRoots = [
  '/audit',
  '/auth',
  '/file-nodes',
  '/health',
  '/identity',
  '/mail',
  '/setup',
  '/shares',
  '/site',
  '/storage',
  '/system',
  '/transfers',
  '/workspaces',
];

function isUnprefixedApiRequestPath(path: string) {
  const normalized = path.replace(/\/+$/, '') || '/';
  if (normalized === '/setup') return false;
  return unprefixedApiRouteRoots.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
}

function requestAcceptsHtml(request: Request) {
  const accept = request.headers.accept;
  if (!accept?.trim()) return true;
  return request.accepts('html') === 'html';
}
