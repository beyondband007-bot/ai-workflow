import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import QRCode from 'qrcode';
import { DataSource, QueryRunner } from 'typeorm';
import { AuthUser } from '../auth/auth-user.interface';
import { AlipayClientService } from './alipay-client.service';

const POINTS_PER_YUAN = 100;
const FINAL_ORDER_STATUSES = new Set(['PAID', 'CANCELED', 'CLOSED', 'REFUNDED', 'AMOUNT_MISMATCH']);

@Injectable()
export class PaymentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly alipayClient: AlipayClientService,
  ) {}

  async createRechargeOrder(currentUser: AuthUser, input: { amount: number; provider: string }) {
    const amount = this.normalizeAmount(input.amount);
    if (input.provider === 'wechat') {
      throw new ServiceUnavailableException('暂未开通微信支付');
    }
    if (input.provider !== 'alipay') {
      throw new BadRequestException('Unsupported payment provider');
    }
    if (!this.alipayClient.isConfigured()) {
      throw new ServiceUnavailableException('Alipay is not configured');
    }

    const outTradeNo = this.generateOutTradeNo();
    const orderToken = randomBytes(24).toString('base64url');
    const points = amount * POINTS_PER_YUAN;
    const subject = `积分充值 ${amount} 元`;

    await this.dataSource.query(
      `
        INSERT INTO payment_orders (
          user_id,
          out_trade_no,
          provider,
          subject,
          total_amount,
          points,
          status,
          status_message,
          client_token_hash
        ) VALUES (?, ?, 'alipay', ?, ?, ?, 'CREATED', '订单已创建', ?)
      `,
      [currentUser.userId, outTradeNo, subject, amount.toFixed(2), points, this.hashToken(orderToken)],
    );

    const order = await this.findOrderForUser(currentUser.userId, outTradeNo);
    return {
      order: this.toClientOrder(order),
      orderToken,
    };
  }

  async getAlipayQrCode(currentUser: AuthUser, outTradeNo: string, orderToken?: string) {
    const order = await this.findOrderForUser(currentUser.userId, outTradeNo);
    this.assertOrderToken(order, orderToken);
    if (FINAL_ORDER_STATUSES.has(order.status)) {
      throw new BadRequestException('Order is not payable');
    }
    if (order.qr_code) {
      const qrCodeDataUrl = order.qr_code_data_url || (await QRCode.toDataURL(order.qr_code, { margin: 1, width: 240 }));
      if (!order.qr_code_data_url) {
        await this.dataSource.query('UPDATE payment_orders SET qr_code_data_url = ? WHERE id = ?', [qrCodeDataUrl, order.id]);
      }
      return {
        order: this.toClientOrder(order),
        qrCode: order.qr_code,
        qrCodeDataUrl,
      };
    }

    const result = await this.alipayClient.call(
      this.alipayClient.buildPrecreateParams({
        out_trade_no: order.out_trade_no,
        total_amount: Number(order.total_amount).toFixed(2),
        subject: order.subject,
        product_code: 'QR_CODE_OFFLINE',
        timeout_express: '5m',
        goods_detail: [
          {
            goods_id: 'workflow-points',
            goods_name: order.subject,
            quantity: 1,
            price: Number(order.total_amount).toFixed(2),
          },
        ],
      }),
    );

    const qrCodeDataUrl = await QRCode.toDataURL(result.qr_code, { margin: 1, width: 240 });

    await this.dataSource.query(
      `
        UPDATE payment_orders
        SET qr_code = ?,
            qr_code_data_url = ?,
            status = 'QR_READY',
            status_message = '订单码已生成，等待支付'
        WHERE id = ?
      `,
      [result.qr_code, qrCodeDataUrl, order.id],
    );

    const updatedOrder = await this.findOrderForUser(currentUser.userId, outTradeNo);
    await this.recordPaymentEvent(updatedOrder.id, 'alipay.precreate', 'alipay', result);

    return {
      order: this.toClientOrder(updatedOrder),
      qrCode: result.qr_code,
      qrCodeDataUrl,
    };
  }

  async syncAlipayOrder(currentUser: AuthUser, outTradeNo: string, orderToken?: string) {
    const order = await this.findOrderForUser(currentUser.userId, outTradeNo);
    this.assertOrderToken(order, orderToken);
    if (FINAL_ORDER_STATUSES.has(order.status)) {
      return this.toClientOrder(order);
    }

    let result: Record<string, string>;
    try {
      result = await this.alipayClient.call(
        this.alipayClient.buildQueryParams({
          out_trade_no: order.out_trade_no,
        }),
      );
    } catch (error) {
      if (this.isAlipayTradeNotExist(error)) {
        await this.dataSource.query(
          `
            UPDATE payment_orders
            SET status = 'WAITING_PAYMENT',
                status_message = '等待用户扫码支付',
                last_checked_at = NOW()
            WHERE id = ?
          `,
          [order.id],
        );
        const updatedOrder = await this.findOrderById(order.id);
        if (updatedOrder.status !== order.status) {
          await this.recordPaymentEvent(updatedOrder.id, 'alipay.query', 'alipay', {
            previousStatus: order.status,
            nextStatus: updatedOrder.status,
            subCode: 'ACQ.TRADE_NOT_EXIST',
            subMsg: '交易不存在',
          });
        }
        return this.toClientOrder(updatedOrder);
      }
      throw error;
    }
    const updatedOrder = await this.applyAlipayTradeStatus(order.id, result);
    if (updatedOrder.status !== order.status) {
      await this.recordPaymentEvent(updatedOrder.id, 'alipay.query', 'alipay', {
        previousStatus: order.status,
        nextStatus: updatedOrder.status,
        ...result,
      });
    }
    return this.toClientOrder(updatedOrder);
  }

  async handleAlipayNotify(params: Record<string, string>) {
    if (!this.alipayClient.verifyNotifyParams(params)) {
      return false;
    }

    const [order] = await this.dataSource.query(
      `
        SELECT *
        FROM payment_orders
        WHERE out_trade_no = ?
        LIMIT 1
      `,
      [params.out_trade_no],
    );
    if (!order) {
      return false;
    }
    if (params.app_id !== this.alipayClient.getAppId()) {
      await this.markAmountMismatch(order.id, '支付宝 app_id 不一致');
      return false;
    }
    if (this.alipayClient.getSellerId() && params.seller_id !== this.alipayClient.getSellerId()) {
      await this.markAmountMismatch(order.id, '支付宝 seller_id 不一致');
      return false;
    }
    if (!this.amountsMatch(params.total_amount, order.total_amount)) {
      await this.markAmountMismatch(order.id, '支付宝通知金额不一致');
      return false;
    }

    await this.recordPaymentEvent(order.id, 'alipay.notify', 'alipay', params);
    if (['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(params.trade_status)) {
      await this.markOrderPaid(order.id, {
        alipayTradeNo: params.trade_no,
        alipayTradeStatus: params.trade_status,
      });
    }

    return true;
  }

  private async applyAlipayTradeStatus(orderId: number, result: Record<string, string>) {
    const [order] = await this.dataSource.query('SELECT * FROM payment_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (result.out_trade_no && result.out_trade_no !== order.out_trade_no) {
      await this.markAmountMismatch(order.id, '支付宝查询订单号不一致');
      return this.findOrderById(order.id);
    }
    if (result.total_amount && !this.amountsMatch(result.total_amount, order.total_amount)) {
      await this.markAmountMismatch(order.id, '支付宝查询金额不一致');
      return this.findOrderById(order.id);
    }

    if (['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(result.trade_status)) {
      await this.markOrderPaid(order.id, {
        alipayTradeNo: result.trade_no,
        alipayTradeStatus: result.trade_status,
      });
    } else if (result.trade_status === 'TRADE_CLOSED') {
      await this.dataSource.query(
        `
          UPDATE payment_orders
          SET status = 'CLOSED',
              status_message = '交易已关闭',
              closed_at = COALESCE(closed_at, NOW()),
              last_checked_at = NOW(),
              alipay_trade_status = ?
          WHERE id = ?
        `,
        [result.trade_status, order.id],
      );
    } else if (result.trade_status === 'WAIT_BUYER_PAY') {
      await this.dataSource.query(
        `
          UPDATE payment_orders
          SET status = ?,
              status_message = ?,
              last_checked_at = NOW(),
              alipay_trade_status = ?
          WHERE id = ?
        `,
        [
          result.buyer_logon_id || result.buyer_user_id || result.buyer_open_id ? 'SCANNED' : 'WAITING_PAYMENT',
          result.buyer_logon_id || result.buyer_user_id || result.buyer_open_id ? '用户已扫码，等待确认' : '等待用户扫码支付',
          result.trade_status,
          order.id,
        ],
      );
    }

    return this.findOrderById(order.id);
  }

  private async markOrderPaid(orderId: number, data: { alipayTradeNo?: string; alipayTradeStatus?: string }) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const [order] = await queryRunner.query('SELECT * FROM payment_orders WHERE id = ? FOR UPDATE', [orderId]);
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      if (order.status === 'PAID') {
        await queryRunner.commitTransaction();
        return;
      }

      const [account] = await queryRunner.query(
        'SELECT * FROM point_accounts WHERE user_id = ? FOR UPDATE',
        [order.user_id],
      );
      if (!account) {
        await queryRunner.query(
          `
            INSERT INTO point_accounts (
              user_id,
              available_points,
              frozen_points,
              total_recharged_points,
              total_consumed_points
            ) VALUES (?, 0, 0, 0, 0)
          `,
          [order.user_id],
        );
      }
      const [lockedAccount] = await queryRunner.query(
        'SELECT * FROM point_accounts WHERE user_id = ? FOR UPDATE',
        [order.user_id],
      );
      const nextAvailablePoints = Number(lockedAccount.available_points ?? 0) + Number(order.points ?? 0);
      const nextTotalRechargedPoints = Number(lockedAccount.total_recharged_points ?? 0) + Number(order.points ?? 0);

      await queryRunner.query(
        `
          UPDATE point_accounts
          SET available_points = ?,
              total_recharged_points = ?
          WHERE user_id = ?
        `,
        [nextAvailablePoints, nextTotalRechargedPoints, order.user_id],
      );
      await queryRunner.query(
        `
          INSERT INTO points_transactions (
            user_id,
            type,
            points,
            balance_after,
            remark
          ) VALUES (?, 'recharge', ?, ?, ?)
        `,
        [order.user_id, order.points, nextAvailablePoints, `支付宝充值订单 ${order.out_trade_no}`],
      );
      await queryRunner.query(
        `
          UPDATE payment_orders
          SET status = 'PAID',
              status_message = '支付成功，积分已到账',
              paid_at = COALESCE(paid_at, NOW()),
              last_checked_at = NOW(),
              alipay_trade_no = ?,
              alipay_trade_status = ?
          WHERE id = ?
        `,
        [data.alipayTradeNo ?? order.alipay_trade_no, data.alipayTradeStatus ?? order.alipay_trade_status, order.id],
      );

      await this.recordPaymentEventWithRunner(queryRunner, order.id, 'alipay.paid', 'alipay', data);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async markAmountMismatch(orderId: number, message: string) {
    await this.dataSource.query(
      `
        UPDATE payment_orders
        SET status = 'AMOUNT_MISMATCH',
            status_message = ?
        WHERE id = ?
      `,
      [message, orderId],
    );
  }

  private async findOrderForUser(userId: number, outTradeNo: string) {
    const [order] = await this.dataSource.query(
      `
        SELECT *
        FROM payment_orders
        WHERE user_id = ?
          AND out_trade_no = ?
        LIMIT 1
      `,
      [userId, outTradeNo],
    );
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  private async findOrderById(orderId: number) {
    const [order] = await this.dataSource.query('SELECT * FROM payment_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  private assertOrderToken(order: Record<string, unknown>, orderToken?: string) {
    if (!orderToken || !order.client_token_hash || this.hashToken(orderToken) !== order.client_token_hash) {
      throw new ForbiddenException('Invalid order token');
    }
  }

  private async recordPaymentEvent(
    orderId: number,
    eventType: string,
    provider: string,
    payload: Record<string, unknown>,
  ) {
    await this.dataSource.query(
      `
        INSERT INTO payment_events (
          order_id,
          event_type,
          provider,
          payload_json
        ) VALUES (?, ?, ?, ?)
      `,
      [orderId, eventType, provider, JSON.stringify(payload)],
    );
  }

  private async recordPaymentEventWithRunner(
    queryRunner: QueryRunner,
    orderId: number,
    eventType: string,
    provider: string,
    payload: Record<string, unknown>,
  ) {
    await queryRunner.query(
      `
        INSERT INTO payment_events (
          order_id,
          event_type,
          provider,
          payload_json
        ) VALUES (?, ?, ?, ?)
      `,
      [orderId, eventType, provider, JSON.stringify(payload)],
    );
  }

  private normalizeAmount(value: number) {
    const amount = Math.floor(Number(value));
    if (!Number.isFinite(amount) || amount < 100) {
      throw new BadRequestException('充值金额不能低于 100 元');
    }
    if (amount % 100 !== 0) {
      throw new BadRequestException('充值金额需为 100 元的整数倍');
    }
    return amount;
  }

  private generateOutTradeNo() {
    return `RC${Date.now()}${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private amountsMatch(left: string | number, right: string | number) {
    return Number(left).toFixed(2) === Number(right).toFixed(2);
  }

  private isAlipayTradeNotExist(error: unknown) {
    return (error as { subCode?: string })?.subCode === 'ACQ.TRADE_NOT_EXIST';
  }

  private toClientOrder(order: Record<string, unknown>) {
    return {
      outTradeNo: order.out_trade_no,
      provider: order.provider,
      subject: order.subject,
      totalAmount: Number(order.total_amount).toFixed(2),
      points: Number(order.points ?? 0),
      status: order.status,
      statusMessage: order.status_message,
      paidAt: order.paid_at,
      createdAt: order.created_at,
    };
  }
}
