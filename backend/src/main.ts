import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { Logger, ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { resolveLoggingConfig } from './logging/logging-config';
import { JsonLoggerService } from './logging/json-logger.service';

async function bootstrap() {
  const loggingConfig = resolveLoggingConfig();
  const jsonLogger =
    loggingConfig.format === 'json' ? new JsonLoggerService() : null;
  if (jsonLogger) {
    jsonLogger.setLogLevels(loggingConfig.nestLogLevels);
  }

  const app = await NestFactory.create(AppModule, {
    rawBody: true, // needed for Stripe webhook signature verification
    logger: jsonLogger ?? loggingConfig.nestLogLevels,
  });

  // Global CORS
  const corsOrigins = process.env.CORS_ORIGINS ?? 'http://localhost:5173';
  app.enableCors({
    origin: true,
    credentials: true,
    exposedHeaders: ['X-Export-Checksum-SHA256', 'Content-Disposition'],
  });

  // Serve legacy local uploads paths used by frontend profile/org images
  const uploadsDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }

  app.use(
    '/uploads',
    express.static(uploadsDir, {
      fallthrough: true,
      setHeaders: (res) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    }),
  );

  const transparentPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W8lQAAAAASUVORK5CYII=',
    'base64',
  );
  app.use('/uploads', (_req, res) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(transparentPng);
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      forbidNonWhitelisted: false,
      transform: false,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  if (jsonLogger) {
    jsonLogger.log(`Sermuno backend running on port ${port}`, 'Bootstrap');
  } else {
    new Logger('Bootstrap').log(`Sermuno backend running on port ${port}`);
  }
}

bootstrap();
