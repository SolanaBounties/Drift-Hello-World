import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { DriftModule } from './drift.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DriftModule
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
