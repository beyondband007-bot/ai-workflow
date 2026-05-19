import { Body, Controller, Get, Headers, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthUser } from '../auth/auth-user.interface';
import { PaymentsService } from './payments.service';

type UploadedVoucherFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

@Controller('api/v1')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('recharge-orders')
  createRechargeOrder(@CurrentUser() currentUser: AuthUser, @Body() body: { amount: number; provider: string }) {
    return this.paymentsService.createRechargeOrder(currentUser, body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('recharge-orders')
  listRechargeOrders(@CurrentUser() currentUser: AuthUser) {
    return this.paymentsService.listRechargeOrders(currentUser);
  }

  @UseGuards(JwtAuthGuard)
  @Post('offline-recharge-orders')
  @UseInterceptors(FileInterceptor('voucher', { limits: { fileSize: 8 * 1024 * 1024 } }))
  createOfflineRechargeOrder(
    @CurrentUser() currentUser: AuthUser,
    @Body() body: { amount: number },
    @UploadedFile() voucher?: UploadedVoucherFile,
  ) {
    return this.paymentsService.createOfflineRechargeOrder(currentUser, body, voucher);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/offline-recharge-orders')
  listOfflineRechargeOrders(@CurrentUser() currentUser: AuthUser, @Query('status') status?: string) {
    return this.paymentsService.listOfflineRechargeOrders(currentUser, status);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/offline-recharge-orders/:outTradeNo/approve')
  approveOfflineRechargeOrder(
    @CurrentUser() currentUser: AuthUser,
    @Param('outTradeNo') outTradeNo: string,
    @Body() body: { transferTradeNo?: string; note?: string },
  ) {
    return this.paymentsService.approveOfflineRechargeOrder(currentUser, outTradeNo, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('admin/offline-recharge-orders/:outTradeNo/reject')
  rejectOfflineRechargeOrder(
    @CurrentUser() currentUser: AuthUser,
    @Param('outTradeNo') outTradeNo: string,
    @Body() body: { reason?: string },
  ) {
    return this.paymentsService.rejectOfflineRechargeOrder(currentUser, outTradeNo, body);
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

  @Post('wechatpay/notify')
  async handleWechatPayNotify(
    @Body() body: Record<string, unknown>,
    @Req() request: Request & { rawBody?: Buffer },
    @Res() response: Response,
  ) {
    const accepted = await this.paymentsService.handleWechatPayNotify(body, {
      timestamp: request.headers['wechatpay-timestamp'],
      nonce: request.headers['wechatpay-nonce'],
      signature: request.headers['wechatpay-signature'],
      bodyText: request.rawBody?.toString('utf8') || JSON.stringify(body),
    });
    response.json(accepted ? { code: 'SUCCESS', message: 'success' } : { code: 'FAIL', message: 'failure' });
  }
}
