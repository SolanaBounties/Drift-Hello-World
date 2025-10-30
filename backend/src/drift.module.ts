// src/drift/drift.module.ts
import { Module } from '@nestjs/common';
import { DriftService } from './drift.service';
import { DriftController } from './drift.controller';

@Module({
  providers: [DriftService],
  controllers: [DriftController],
  exports: [DriftService],
})
export class DriftModule {}
