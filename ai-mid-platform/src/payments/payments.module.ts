import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { AlipayClientService } from './alipay-client.service';
import { PaymentsService } from './payments.service';
import { WechatPayClientService } from './wechatpay-client.service';

@Module({
  controllers: [PaymentsController],
  providers: [AlipayClientService, WechatPayClientService, PaymentsService],
})
export class PaymentsModule {}
