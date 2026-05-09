import { Body, Controller, Get, Headers, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/auth-user.interface';
import { PaymentsService } from './payments.service';

@Controller('api/v1')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('recharge-orders')
  createRechargeOrder(@CurrentUser() currentUser: AuthUser, @Body() body: { amount: number; provider: string }) {
    return this.paymentsService.createRechargeOrder(currentUser, body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('recharge-orders/:outTradeNo/qrcode')
  getAlipayQrCode(
    @CurrentUser() currentUser: AuthUser,
    @Param('outTradeNo') outTradeNo: string,
    @Headers('x-order-token') orderToken?: string,
  ) {
    return this.paymentsService.getAlipayQrCode(currentUser, outTradeNo, orderToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('recharge-orders/:outTradeNo/sync')
  syncAlipayOrder(
    @CurrentUser() currentUser: AuthUser,
    @Param('outTradeNo') outTradeNo: string,
    @Headers('x-order-token') orderToken?: string,
  ) {
    return this.paymentsService.syncAlipayOrder(currentUser, outTradeNo, orderToken);
  }

  @Post('alipay/notify')
  async handleAlipayNotify(@Body() body: Record<string, string>, @Res() response: Response) {
    const accepted = await this.paymentsService.handleAlipayNotify(body);
    response.type('text/plain').send(accepted ? 'success' : 'failure');
  }
}
