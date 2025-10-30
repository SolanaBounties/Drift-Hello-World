// src/drift/drift.controller.ts
import { Controller, Get, Post, Query } from '@nestjs/common';
import { DriftService } from './drift.service';

@Controller('drift')
export class DriftController {
  constructor(private readonly drift: DriftService) {}

  @Get('status') status() {
    return this.drift.status();
  }
  @Post('init') init() {
    return this.drift.initAccount();
  }
  @Get('markets') markets() {
    return this.drift.markets();
  }
  @Get('positions') positions() {
    return this.drift.positions();
  }
  @Get('account') account() {
    return this.drift.accountValue();
  }
  @Post('open')
  open(
    @Query('marketIndex') mi: string,
    @Query('dir') dir: 'long' | 'short',
    @Query('size') sz: string,
  ) {
    return this.drift.open(Number(mi ?? 0), dir ?? 'long', Number(sz ?? 0.01));
  }
  @Post('close')
  close(@Query('marketIndex') mi: string) {
    return this.drift.close(Number(mi ?? 0));
  }
  @Post('deposit-usdc')
  deposit(@Query('amount') amt: string) {
    return this.drift.depositUsdc(Number(amt ?? 5));
  }
  @Get('doctor') doctor() {
    return this.drift.doctor();
  }
}
