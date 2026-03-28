import { Module } from '@nestjs/common';
import { PointAccountsController } from './point-accounts.controller';
import { PointAccountsService } from './point-accounts.service';

@Module({
  controllers: [PointAccountsController],
  providers: [PointAccountsService],
  exports: [PointAccountsService],
})
export class PointAccountsModule {}
