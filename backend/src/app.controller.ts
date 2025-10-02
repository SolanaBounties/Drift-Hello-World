import { Controller, Get } from '@nestjs/common';
import { getDb } from './db';

@Controller()
export class AppController {
  @Get('/')
  health() {
    return { ok: true, routes: ['/api/seed', '/api/examples'] };
  }

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
    await db.run('INSERT INTO examples (name) VALUES (?)', ['hello-drift']);
    await db.close();
    return { ok: true };
  }
}
