import { Controller, Get } from '@nestjs/common';
import { getDb } from './db';

@Controller()
export class AppController {
  @Get('/')
  root() { return { ok: true }; }

  @Get('/health')
  health() { return { ok: true }; }

  @Get('/api/examples')
  async list() {
    const db = await getDb();
    const rows = await db.all('SELECT * FROM examples ORDER BY id DESC');
    await db.close();
    return rows;
  }

  @Get('/api/seed')
  async seed() {
    const db = await getDb();
    await db.run('INSERT INTO examples (name, is_seed) VALUES (?, 1)', ['hello-drift']);
    await db.close();
    return { ok: true };
  }
}