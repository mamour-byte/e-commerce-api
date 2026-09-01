import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';

export function getAllowedOrigins(): string[] {
  return (
    process.env.FRONTEND_URLS ??
    'http://localhost:5173,https://hayatstore-five.vercel.app'
  )
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const logger = new Logger('Bootstrap');
  const allowedOrigins = getAllowedOrigins();

  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id'],
    credentials: true,
  });

  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`Application running on http://localhost:${port}/api`);
}
void bootstrap();
