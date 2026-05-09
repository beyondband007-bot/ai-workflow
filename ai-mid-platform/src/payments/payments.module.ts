import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { AlipayClientService } from './alipay-client.service';
import { PaymentsService } from './payments.service';

@Module({
  controllers: [PaymentsController],
  providers: [AlipayClientService, PaymentsService],
})
export class PaymentsModule {}
