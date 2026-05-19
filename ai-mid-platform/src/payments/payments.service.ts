import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import QRCode from 'qrcode';
import { DataSource, QueryRunner } from 'typeorm';
import { AuthUser } from '../auth/auth-user.interface';
import { AlipayClientService } from './alipay-client.service';
import { WechatPayClientService, WechatPayQueryResult } from './wechatpay-client.service';

const POINTS_PER_YUAN = 100;
const PAYMENT_ORDER_EXPIRE_MINUTES = 3;
const FINAL_ORDER_STATUSES = new Set(['PAID', 'CANCELED', 'CLOSED', 'EXPIRED', 'REFUNDED', 'AMOUNT_MISMATCH', 'REJECTED']);
const ONLINE_PENDING_STATUSES = ['CREATED', 'QR_READY', 'WAITING_PAYMENT', 'SCANNED'];
const OFFLINE_PENDING_STATUSES = ['PENDING_REVIEW', 'REVIEWING'];

type MarkPaidData = {
  provider?: string;
  tradeNo?: string;
  tradeStatus?: string;
  alipayTradeNo?: string;
  alipayTradeStatus?: string;
};

type UploadedVoucherFile = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly alipayClient: AlipayClientService,
    private readonly wechatPayClient: WechatPayClientService,
  ) {}

  async createRechargeOrder(currentUser: AuthUser, input: { amount: number; provider?: string }) {
    const amount = this.normalizeAmount(input.amount);
    const provider = this.normalizeProvider(input.provider);

    if (provider === 'alipay' && !this.alipayClient.isConfigured()) {
      throw new ServiceUnavailableException('Alipay is not configured');
    }
    if (provider === 'wechat' && !this.wechatPayClient.isConfigured()) {
      throw new ServiceUnavailableException('Wechat Pay is not configured');
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
        ) VALUES (?, ?, ?, ?, ?, ?, 'CREATED', '订单已创建', ?)
      `,
      [currentUser.userId, outTradeNo, provider, subject, amount.toFixed(2), points, this.hashToken(orderToken)],
    );

    const order = await this.findOrderForUser(currentUser.userId, outTradeNo);
    return {
      order: this.toClientOrder(order),
      orderToken,
    };
  }

  async listRechargeOrders(currentUser: AuthUser) {
    await this.expireTimedOutOnlineOrders(currentUser.userId);
    const rows = await this.dataSource.query(
      `
        SELECT *
        FROM payment_orders
        WHERE user_id = ?
          AND provider IN ('alipay', 'wechat', 'offline_transfer')
        ORDER BY created_at DESC
        LIMIT 100
      `,
      [currentUser.userId],
    );

    return rows.map((order: Record<string, unknown>) => this.toClientOrder(order));
  }

  async createOfflineRechargeOrder(
    currentUser: AuthUser,
    input: { amount: number },
    voucherFile?: UploadedVoucherFile,
  ) {
    const amount = this.normalizeAmount(input.amount);
    if (!voucherFile) {
      throw new BadRequestException('请先上传支付凭证');
    }
    this.assertVoucherFile(voucherFile);

    const [pendingCountRow] = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM payment_orders
        WHERE user_id = ?
          AND provider = 'offline_transfer'
          AND status IN ('PENDING_REVIEW', 'REVIEWING')
      `,
      [currentUser.userId],
    );
    if (Number(pendingCountRow?.count || 0) >= 2) {
      throw new BadRequestException('每个用户最多只能有 2 个待审核/审核中的线下充值订单，请等待审核后再提交');
    }

    const voucher = await this.storeVoucherFile(currentUser.userId, voucherFile);
    const outTradeNo = this.generateOfflineOutTradeNo();
    const points = amount * POINTS_PER_YUAN;

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
          voucher_file_name,
          voucher_file_url
        ) VALUES (?, ?, 'offline_transfer', ?, ?, ?, 'PENDING_REVIEW', '线下转账待审核', ?, ?)
      `,
      [
        currentUser.userId,
        outTradeNo,
        `线下转账积分充值 ${amount} 元`,
        amount.toFixed(2),
        points,
        voucher.fileName,
        voucher.fileUrl,
      ],
    );

    const order = await this.findOrderForUser(currentUser.userId, outTradeNo);
    await this.recordPaymentEvent(order.id, 'offline.submit', 'offline_transfer', {
      voucherFileName: voucher.fileName,
      amount,
    });

    return {
      order: this.toClientOrder(order),
    };
  }

  async listOfflineRechargeOrders(currentUser: AuthUser, status?: string) {
    await this.assertAdmin(currentUser);
    const normalizedStatus = String(status || 'pending').trim().toLowerCase();
    let statusSql = "AND po.status IN ('PENDING_REVIEW', 'REVIEWING')";
    if (normalizedStatus === 'approved') {
      statusSql = "AND po.status = 'PAID'";
    } else if (normalizedStatus === 'rejected') {
      statusSql = "AND po.status = 'REJECTED'";
    } else if (normalizedStatus === 'all') {
      statusSql = '';
    }

    const rows = await this.dataSource.query(
      `
        SELECT
          po.*,
          u.email AS user_email,
          u.username AS user_username,
          u.nickname AS user_nickname,
          reviewer.username AS reviewer_username
        FROM payment_orders po
        INNER JOIN users u ON u.id = po.user_id
        LEFT JOIN users reviewer ON reviewer.id = po.reviewed_by
        WHERE po.provider = 'offline_transfer'
        ${statusSql}
        ORDER BY po.created_at DESC
        LIMIT 200
      `,
    );

    return rows.map((order: Record<string, unknown>) => this.toAdminOfflineOrder(order));
  }

  async approveOfflineRechargeOrder(
    currentUser: AuthUser,
    outTradeNo: string,
    input: { transferTradeNo?: string; note?: string },
  ) {
    await this.assertAdmin(currentUser);
    const transferTradeNo = String(input.transferTradeNo || '').trim();
    if (!transferTradeNo) {
      throw new BadRequestException('审核通过必须填写交易单号');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const [order] = await queryRunner.query(
        "SELECT * FROM payment_orders WHERE out_trade_no = ? AND provider = 'offline_transfer' FOR UPDATE",
        [outTradeNo],
      );
      if (!order) {
        throw new NotFoundException('Order not found');
      }
      if (!OFFLINE_PENDING_STATUSES.includes(order.status)) {
        throw new BadRequestException('该订单当前状态不可审核通过');
      }

      const [duplicate] = await queryRunner.query(
        `
          SELECT id, out_trade_no
          FROM payment_orders
          WHERE transfer_trade_no = ?
            AND id <> ?
          LIMIT 1
        `,
        [transferTradeNo, order.id],
      );

      if (duplicate) {
        const reason = `交易单号 ${transferTradeNo} 已存在于订单 ${duplicate.out_trade_no}，疑似重复提交，审核失败`;
        await queryRunner.query(
          `
            UPDATE payment_orders
            SET status = 'REJECTED',
                status_message = '交易单号重复，审核失败',
                review_note = ?,
                reviewed_by = ?,
                reviewed_at = NOW(),
                last_checked_at = NOW()
            WHERE id = ?
          `,
          [reason, currentUser.userId, order.id],
        );
        await this.recordPaymentEventWithRunner(queryRunner, order.id, 'offline.reject_duplicate', 'offline_transfer', {
          transferTradeNo,
          duplicateOrderNo: duplicate.out_trade_no,
        });
        await queryRunner.commitTransaction();
        return {
          duplicated: true,
          message: reason,
          order: this.toClientOrder(await this.findOrderById(order.id)),
        };
      }

      const [account] = await queryRunner.query('SELECT * FROM point_accounts WHERE user_id = ? FOR UPDATE', [
        order.user_id,
      ]);
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
      const [lockedAccount] = await queryRunner.query('SELECT * FROM point_accounts WHERE user_id = ? FOR UPDATE', [
        order.user_id,
      ]);
      const nextAvailablePoints = Number(lockedAccount.available_points ?? 0) + Number(order.points ?? 0);
      const nextTotalRechargedPoints =
        Number(lockedAccount.total_recharged_points ?? 0) + Number(order.points ?? 0);

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
        [order.user_id, order.points, nextAvailablePoints, `线下转账充值订单 ${order.out_trade_no}`],
      );
      await queryRunner.query(
        `
          UPDATE payment_orders
          SET status = 'PAID',
              status_message = '线下转账审核通过，积分已到账',
              paid_at = COALESCE(paid_at, NOW()),
              last_checked_at = NOW(),
              reviewed_by = ?,
              reviewed_at = NOW(),
              review_note = ?,
              transfer_trade_no = ?
          WHERE id = ?
        `,
        [currentUser.userId, String(input.note || '').trim() || null, transferTradeNo, order.id],
      );
      await this.recordPaymentEventWithRunner(queryRunner, order.id, 'offline.approve', 'offline_transfer', {
        transferTradeNo,
        note: input.note,
      });

      await queryRunner.commitTransaction();
      return {
        duplicated: false,
        message: '审核通过，积分已到账',
        order: this.toClientOrder(await this.findOrderById(order.id)),
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async rejectOfflineRechargeOrder(
    currentUser: AuthUser,
    outTradeNo: string,
    input: { reason?: string },
  ) {
    await this.assertAdmin(currentUser);
    const reason = String(input.reason || '').trim();
    if (!reason) {
      throw new BadRequestException('拒审必须填写原因');
    }

    const [order] = await this.dataSource.query(
      "SELECT * FROM payment_orders WHERE out_trade_no = ? AND provider = 'offline_transfer' LIMIT 1",
      [outTradeNo],
    );
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!OFFLINE_PENDING_STATUSES.includes(order.status)) {
      throw new BadRequestException('该订单当前状态不可拒审');
    }

    await this.dataSource.query(
      `
        UPDATE payment_orders
        SET status = 'REJECTED',
            status_message = '审核未通过',
            review_note = ?,
            reviewed_by = ?,
            reviewed_at = NOW(),
            last_checked_at = NOW()
        WHERE id = ?
      `,
      [reason, currentUser.userId, order.id],
    );
    await this.recordPaymentEvent(order.id, 'offline.reject', 'offline_transfer', { reason });

    return {
      message: '已拒审',
      order: this.toClientOrder(await this.findOrderById(order.id)),
    };
  }

  async getAlipayQrCode(currentUser: AuthUser, outTradeNo: string, orderToken?: string) {
    const order = await this.expireTimedOutOnlineOrder(await this.findOrderForUser(currentUser.userId, outTradeNo));
    this.assertOrderToken(order, orderToken);
    if (FINAL_ORDER_STATUSES.has(order.status)) {
      throw new BadRequestException('Order is not payable');
    }
    if (order.qr_code) {
      return this.getStoredQrCode(order);
    }

    if (order.provider === 'wechat') {
      return this.createWechatPayQrCode(order, currentUser.userId, outTradeNo);
    }
    if (order.provider === 'alipay') {
      return this.createAlipayQrCode(order, currentUser.userId, outTradeNo);
    }

    throw new BadRequestException('Unsupported payment provider');
  }

  async syncAlipayOrder(currentUser: AuthUser, outTradeNo: string, orderToken?: string) {
    const order = await this.expireTimedOutOnlineOrder(await this.findOrderForUser(currentUser.userId, outTradeNo));
    this.assertOrderToken(order, orderToken);
    if (FINAL_ORDER_STATUSES.has(order.status)) {
      return this.toClientOrder(order);
    }

    if (order.provider === 'wechat') {
      return this.syncWechatPayOrder(order);
    }
    if (order.provider !== 'alipay') {
      throw new BadRequestException('Unsupported payment provider');
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
                status_message = '等待支付',
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
            subMsg: 'Trade does not exist',
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
    if (!order || order.provider !== 'alipay') {
      return false;
    }
    if (params.app_id !== this.alipayClient.getAppId()) {
      await this.markAmountMismatch(order.id, '支付宝 app_id 不匹配');
      return false;
    }
    if (this.alipayClient.getSellerId() && params.seller_id !== this.alipayClient.getSellerId()) {
      await this.markAmountMismatch(order.id, '支付宝 seller_id 不匹配');
      return false;
    }
    if (!this.amountsMatch(params.total_amount, order.total_amount)) {
      await this.markAmountMismatch(order.id, '支付宝回调金额不匹配');
      return false;
    }

    await this.recordPaymentEvent(order.id, 'alipay.notify', 'alipay', params);
    if (['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(params.trade_status)) {
      await this.markOrderPaid(order.id, {
        provider: 'alipay',
        alipayTradeNo: params.trade_no,
        alipayTradeStatus: params.trade_status,
      });
    }

    return true;
  }

  async handleWechatPayNotify(body: {
    event_type?: string;
    resource?: {
      associated_data?: string;
      nonce?: string;
      ciphertext?: string;
    };
  }, signatureInput?: {
    timestamp?: string | string[];
    nonce?: string | string[];
    signature?: string | string[];
    bodyText?: string;
  }) {
    if (!this.wechatPayClient.verifyNotifySignature(signatureInput || {})) {
      return false;
    }

    let result: WechatPayQueryResult;
    try {
      result = this.wechatPayClient.decryptNotifyResource(body.resource || {});
    } catch {
      return false;
    }

    if (!result.out_trade_no) {
      return false;
    }

    const [order] = await this.dataSource.query(
      `
        SELECT *
        FROM payment_orders
        WHERE out_trade_no = ?
        LIMIT 1
      `,
      [result.out_trade_no],
    );
    if (!order || order.provider !== 'wechat') {
      return false;
    }
    if (typeof result.amount?.total === 'number' && result.amount.total !== this.amountToCents(order.total_amount)) {
      await this.markAmountMismatch(order.id, '微信支付回调金额不匹配');
      return false;
    }

    await this.recordPaymentEvent(order.id, 'wechatpay.notify', 'wechat', {
      eventType: body.event_type,
      ...result,
    });
    await this.applyWechatPayTradeStatus(order.id, result);
    return true;
  }

  private async getStoredQrCode(order: Record<string, any>) {
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

  private async createAlipayQrCode(order: Record<string, any>, userId: number, outTradeNo: string) {
    const result = await this.alipayClient.call(
      this.alipayClient.buildPrecreateParams({
        out_trade_no: order.out_trade_no,
        total_amount: Number(order.total_amount).toFixed(2),
        subject: order.subject,
        product_code: 'QR_CODE_OFFLINE',
        timeout_express: `${PAYMENT_ORDER_EXPIRE_MINUTES}m`,
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

    const updatedOrder = await this.findOrderForUser(userId, outTradeNo);
    await this.recordPaymentEvent(updatedOrder.id, 'alipay.precreate', 'alipay', result);

    return {
      order: this.toClientOrder(updatedOrder),
      qrCode: result.qr_code,
      qrCodeDataUrl,
    };
  }

  private async createWechatPayQrCode(order: Record<string, any>, userId: number, outTradeNo: string) {
    const result = await this.wechatPayClient.createNativeOrder({
      outTradeNo: order.out_trade_no,
      description: order.subject,
      totalCents: this.amountToCents(order.total_amount),
      expireMinutes: PAYMENT_ORDER_EXPIRE_MINUTES,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(result.code_url, { margin: 1, width: 240 });

    await this.dataSource.query(
      `
        UPDATE payment_orders
        SET qr_code = ?,
            qr_code_data_url = ?,
            status = 'QR_READY',
            status_message = '微信支付订单码已生成，等待支付'
        WHERE id = ?
      `,
      [result.code_url, qrCodeDataUrl, order.id],
    );

    const updatedOrder = await this.findOrderForUser(userId, outTradeNo);
    await this.recordPaymentEvent(updatedOrder.id, 'wechatpay.native', 'wechat', result);

    return {
      order: this.toClientOrder(updatedOrder),
      qrCode: result.code_url,
      qrCodeDataUrl,
    };
  }

  private async syncWechatPayOrder(order: Record<string, any>) {
    let result: WechatPayQueryResult;
    try {
      result = await this.wechatPayClient.queryOrder(order.out_trade_no);
    } catch (error) {
      if ((error as { wechatCode?: string })?.wechatCode === 'ORDERNOTEXIST') {
        await this.dataSource.query(
          `
            UPDATE payment_orders
            SET status = 'WAITING_PAYMENT',
                status_message = '等待支付',
                last_checked_at = NOW()
            WHERE id = ?
          `,
          [order.id],
        );
        return this.toClientOrder(await this.findOrderById(order.id));
      }
      throw error;
    }

    const updatedOrder = await this.applyWechatPayTradeStatus(order.id, result);
    if (updatedOrder.status !== order.status) {
      await this.recordPaymentEvent(updatedOrder.id, 'wechatpay.query', 'wechat', {
        previousStatus: order.status,
        nextStatus: updatedOrder.status,
        ...result,
      });
    }
    return this.toClientOrder(updatedOrder);
  }

  private async applyAlipayTradeStatus(orderId: number, result: Record<string, string>) {
    const [order] = await this.dataSource.query('SELECT * FROM payment_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (result.out_trade_no && result.out_trade_no !== order.out_trade_no) {
      await this.markAmountMismatch(order.id, '支付宝查询订单号不匹配');
      return this.findOrderById(order.id);
    }
    if (result.total_amount && !this.amountsMatch(result.total_amount, order.total_amount)) {
      await this.markAmountMismatch(order.id, '支付宝查询金额不匹配');
      return this.findOrderById(order.id);
    }

    if (['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(result.trade_status)) {
      await this.markOrderPaid(order.id, {
        provider: 'alipay',
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
      const scanned = Boolean(result.buyer_logon_id || result.buyer_user_id || result.buyer_open_id);
      await this.dataSource.query(
        `
          UPDATE payment_orders
          SET status = ?,
              status_message = ?,
              last_checked_at = NOW(),
              alipay_trade_status = ?
          WHERE id = ?
        `,
        [scanned ? 'SCANNED' : 'WAITING_PAYMENT', scanned ? '用户已扫码，等待确认支付' : '等待支付', result.trade_status, order.id],
      );
    }

    return this.findOrderById(order.id);
  }

  private async applyWechatPayTradeStatus(orderId: number, result: WechatPayQueryResult) {
    const [order] = await this.dataSource.query('SELECT * FROM payment_orders WHERE id = ? LIMIT 1', [orderId]);
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (result.out_trade_no && result.out_trade_no !== order.out_trade_no) {
      await this.markAmountMismatch(order.id, '微信支付订单号不匹配');
      return this.findOrderById(order.id);
    }
    if (typeof result.amount?.total === 'number' && result.amount.total !== this.amountToCents(order.total_amount)) {
      await this.markAmountMismatch(order.id, '微信支付金额不匹配');
      return this.findOrderById(order.id);
    }

    if (result.trade_state === 'SUCCESS') {
      await this.markOrderPaid(order.id, {
        provider: 'wechat',
        tradeNo: result.transaction_id,
        tradeStatus: result.trade_state,
      });
    } else if (['CLOSED', 'REVOKED', 'PAYERROR'].includes(result.trade_state || '')) {
      await this.dataSource.query(
        `
          UPDATE payment_orders
          SET status = 'CLOSED',
              status_message = ?,
              closed_at = COALESCE(closed_at, NOW()),
              last_checked_at = NOW()
          WHERE id = ?
        `,
        [result.trade_state_desc || this.getWechatPayStatusMessage(result.trade_state) || '微信支付订单已关闭', order.id],
      );
    } else if (['NOTPAY', 'USERPAYING', 'ACCEPT'].includes(result.trade_state || '')) {
      await this.dataSource.query(
        `
          UPDATE payment_orders
          SET status = ?,
              status_message = ?,
              last_checked_at = NOW()
          WHERE id = ?
        `,
        [
          result.trade_state === 'USERPAYING' ? 'SCANNED' : 'WAITING_PAYMENT',
          result.trade_state_desc || this.getWechatPayStatusMessage(result.trade_state) || '等待支付',
          order.id,
        ],
      );
    }

    return this.findOrderById(order.id);
  }

  private async markOrderPaid(orderId: number, data: MarkPaidData) {
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

      const provider = data.provider || order.provider || 'alipay';
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
        [order.user_id, order.points, nextAvailablePoints, `${this.getProviderLabel(provider)}充值订单 ${order.out_trade_no}`],
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
        [
          provider === 'alipay' ? data.alipayTradeNo ?? data.tradeNo ?? order.alipay_trade_no : order.alipay_trade_no,
          provider === 'alipay' ? data.alipayTradeStatus ?? data.tradeStatus ?? order.alipay_trade_status : order.alipay_trade_status,
          order.id,
        ],
      );

      await this.recordPaymentEventWithRunner(
        queryRunner,
        order.id,
        provider === 'wechat' ? 'wechatpay.paid' : 'alipay.paid',
        provider,
        data,
      );
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

  private async expireTimedOutOnlineOrders(userId?: number) {
    const userCondition = userId ? 'AND user_id = ?' : '';
    await this.dataSource.query(
      `
        UPDATE payment_orders
        SET status = 'EXPIRED',
            status_message = '订单超时',
            closed_at = COALESCE(closed_at, NOW()),
            last_checked_at = NOW()
        WHERE provider IN ('alipay', 'wechat')
          AND status IN ('CREATED', 'QR_READY', 'WAITING_PAYMENT', 'SCANNED')
          AND created_at <= DATE_SUB(NOW(), INTERVAL ${PAYMENT_ORDER_EXPIRE_MINUTES} MINUTE)
          ${userCondition}
      `,
      userId ? [userId] : [],
    );
  }

  private async expireTimedOutOnlineOrder(order: Record<string, any>) {
    if (
      ['alipay', 'wechat'].includes(String(order.provider || '')) &&
      ONLINE_PENDING_STATUSES.includes(String(order.status || '')) &&
      this.isOnlineOrderExpired(order)
    ) {
      await this.dataSource.query(
        `
          UPDATE payment_orders
          SET status = 'EXPIRED',
              status_message = '订单超时',
              closed_at = COALESCE(closed_at, NOW()),
              last_checked_at = NOW()
          WHERE id = ?
        `,
        [order.id],
      );
      return this.findOrderById(order.id);
    }
    return order;
  }

  private isOnlineOrderExpired(order: Record<string, any>) {
    const createdAt = new Date(order.created_at);
    if (Number.isNaN(createdAt.getTime())) {
      return false;
    }
    return Date.now() - createdAt.getTime() >= PAYMENT_ORDER_EXPIRE_MINUTES * 60 * 1000;
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

  private async assertAdmin(currentUser: AuthUser) {
    const [user] = await this.dataSource.query('SELECT id, role FROM users WHERE id = ? LIMIT 1', [currentUser.userId]);
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('仅管理员可以访问线下充值审核');
    }
  }

  private assertVoucherFile(file: UploadedVoucherFile) {
    const allowedMimeTypes = new Set([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/bmp',
      'application/pdf',
    ]);
    if (!allowedMimeTypes.has(file.mimetype)) {
      throw new BadRequestException('支付凭证仅支持图片或 PDF');
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new BadRequestException('支付凭证不能超过 8MB');
    }
  }

  private async storeVoucherFile(userId: number, file: UploadedVoucherFile) {
    const targetDir = this.getVoucherDir();
    await mkdir(targetDir, { recursive: true });

    const extension = this.resolveVoucherExtension(file);
    const fileName = `${userId}-${Date.now()}-${randomUUID()}${extension}`;
    const filePath = resolve(targetDir, fileName);
    await writeFile(filePath, file.buffer);

    return {
      fileName,
      fileUrl: `/portal/recharge-vouchers/${fileName}`,
    };
  }

  private getVoucherDir() {
    const configuredDir = this.configService.get<string>('RECHARGE_VOUCHER_DIR');
    return configuredDir
      ? resolve(configuredDir)
      : resolve(process.cwd(), '..', 'client-portal', 'recharge-vouchers');
  }

  private resolveVoucherExtension(file: UploadedVoucherFile) {
    const originalExt = extname(file.originalname || '').toLowerCase();
    if (originalExt && /^[.][a-z0-9]+$/.test(originalExt)) {
      return originalExt;
    }
    const mimeTypeMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/bmp': '.bmp',
      'application/pdf': '.pdf',
    };
    return mimeTypeMap[file.mimetype] || '.bin';
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
      throw new BadRequestException('Recharge amount cannot be lower than 100 CNY');
    }
    if (amount % 100 !== 0) {
      throw new BadRequestException('Recharge amount must be a multiple of 100 CNY');
    }
    return amount;
  }

  private normalizeProvider(value?: string) {
    const provider = String(value || 'alipay').trim().toLowerCase();
    if (!['alipay', 'wechat'].includes(provider)) {
      throw new BadRequestException('Unsupported payment provider');
    }
    return provider;
  }

  private generateOutTradeNo() {
    return `RC${Date.now()}${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private generateOfflineOutTradeNo() {
    return `OF${Date.now()}${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private amountsMatch(left: string | number, right: string | number) {
    return Number(left).toFixed(2) === Number(right).toFixed(2);
  }

  private amountToCents(value: string | number) {
    return Math.round(Number(value) * 100);
  }

  private isAlipayTradeNotExist(error: unknown) {
    return (error as { subCode?: string })?.subCode === 'ACQ.TRADE_NOT_EXIST';
  }

  private getProviderLabel(provider: string) {
    if (provider === 'wechat') {
      return '微信支付';
    }
    if (provider === 'offline_transfer') {
      return '线下转账';
    }
    return '支付宝';
  }

  private getWechatPayStatusMessage(tradeState?: string) {
    const messages: Record<string, string> = {
      SUCCESS: '支付成功，积分已到账',
      REFUND: '订单已转入退款',
      NOTPAY: '等待支付',
      CLOSED: '订单已关闭',
      REVOKED: '订单已撤销',
      USERPAYING: '用户已扫码，等待确认支付',
      PAYERROR: '支付失败',
      ACCEPT: '支付处理中',
    };
    return messages[String(tradeState || '')] || '';
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
      reviewNote: order.review_note,
      transferTradeNo: order.transfer_trade_no,
      voucherFileUrl: order.voucher_file_url,
      paidAt: order.paid_at,
      createdAt: order.created_at,
      reviewedAt: order.reviewed_at,
    };
  }

  private toAdminOfflineOrder(order: Record<string, unknown>) {
    return {
      ...this.toClientOrder(order),
      user: {
        id: order.user_id,
        email: order.user_email,
        username: order.user_username,
        nickname: order.user_nickname,
      },
      reviewedBy: order.reviewer_username || order.reviewed_by || null,
    };
  }
}
