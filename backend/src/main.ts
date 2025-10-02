import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getDb } from './db';

async function cleanSeedRows() {
  const db = await getDb();
  try {
    await db.run('DELETE FROM examples WHERE is_seed = 1');
  } finally {
    await db.close();
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
    credentials: true,
  });

  await cleanSeedRows();
  await app.listen(3000);
}
bootstrap();
