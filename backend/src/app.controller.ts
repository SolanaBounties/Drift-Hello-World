import { Controller, Get } from '@nestjs/common';
import { getDb } from './db';
import { DriftService } from './drift.service';

@Controller()
export class AppController {
  constructor(private readonly driftService: DriftService) {}

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

  @Get('/api/drift/account')
  async getDriftAccount() {
    return await this.driftService.getUserAccount();
  }

  @Get('/api/drift/markets')
  async getMarkets() {
    return await this.driftService.getMarketInfo();
  }

  @Get('/api/drift/spot-markets')
  async getSpotMarkets() {
    return await this.driftService.getSpotMarkets();
  }

  @Get('/api/drift/balance')
  async getBalance() {
    return await this.driftService.getWalletBalance();
  }
}