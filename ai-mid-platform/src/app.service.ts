import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';

@Injectable()
export class AppService implements OnModuleInit {
  private readonly logger = new Logger(AppService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureUsersSchemaColumns();
    await this.ensurePaymentOrderReviewSchema();
    await this.ensurePaymentOrderChineseText();
    await this.ensureTimedOutPaymentOrders();
    await this.ensureInitialAdminUsers();
    await this.ensurePortalAvatarDir();
    await this.ensurePortalRechargeVoucherDir();
  }

  getHello(): string {
    return 'AI Mid Platform is running.';
  }

  async getDatabaseHealth() {
    const result = await this.dataSource.query('SELECT 1 AS ok');
    const pingValue = Number(result[0]?.ok);

    return {
      status: 'ok',
      database: this.dataSource.options.database,
      ping: pingValue === 1,
    };
  }

  private async ensureUsersSchemaColumns() {
    const rows = await this.dataSource.query(
      `
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'users'
      `,
    );

    const existingColumns = new Set(
      rows.map((row: { COLUMN_NAME?: string }) => String(row.COLUMN_NAME || '')),
    );
    const alterStatements: string[] = [];

    if (!existingColumns.has('nickname')) {
      alterStatements.push(
        'ALTER TABLE users ADD COLUMN nickname VARCHAR(100) NULL AFTER username',
      );
    }

    if (!existingColumns.has('avatar_img')) {
      alterStatements.push(
        'ALTER TABLE users ADD COLUMN avatar_img VARCHAR(500) NULL AFTER nickname',
      );
    }

    if (!existingColumns.has('phone')) {
      alterStatements.push(
        'ALTER TABLE users ADD COLUMN phone VARCHAR(32) NULL AFTER avatar_img',
      );
    }

    if (!existingColumns.has('address')) {
      alterStatements.push(
        'ALTER TABLE users ADD COLUMN address VARCHAR(255) NULL AFTER phone',
      );
    }

    if (!existingColumns.has('role')) {
      alterStatements.push(
        "ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'normal' AFTER address",
      );
    }

    for (const statement of alterStatements) {
      await this.dataSource.query(statement);
      this.logger.log(`Applied schema update: ${statement}`);
    }
  }

  private async ensurePaymentOrderReviewSchema() {
    const rows = await this.dataSource.query(
      `
        SELECT COLUMN_NAME
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'payment_orders'
      `,
    );

    const existingColumns = new Set(
      rows.map((row: { COLUMN_NAME?: string }) => String(row.COLUMN_NAME || '')),
    );
    const alterStatements: string[] = [];

    if (!existingColumns.has('reviewed_by')) {
      alterStatements.push('ALTER TABLE payment_orders ADD COLUMN reviewed_by INT NULL AFTER last_checked_at');
    }

    if (!existingColumns.has('reviewed_at')) {
      alterStatements.push('ALTER TABLE payment_orders ADD COLUMN reviewed_at DATETIME NULL AFTER reviewed_by');
    }

    if (!existingColumns.has('review_note')) {
      alterStatements.push('ALTER TABLE payment_orders ADD COLUMN review_note VARCHAR(500) NULL AFTER reviewed_at');
    }

    if (!existingColumns.has('transfer_trade_no')) {
      alterStatements.push('ALTER TABLE payment_orders ADD COLUMN transfer_trade_no VARCHAR(128) NULL AFTER review_note');
    }

    if (!existingColumns.has('voucher_file_name')) {
      alterStatements.push('ALTER TABLE payment_orders ADD COLUMN voucher_file_name VARCHAR(255) NULL AFTER transfer_trade_no');
    }

    if (!existingColumns.has('voucher_file_url')) {
      alterStatements.push('ALTER TABLE payment_orders ADD COLUMN voucher_file_url VARCHAR(500) NULL AFTER voucher_file_name');
    }

    for (const statement of alterStatements) {
      await this.dataSource.query(statement);
      this.logger.log(`Applied schema update: ${statement}`);
    }

    await this.ensurePaymentOrderTransferTradeNoIndex();
  }

  private async ensurePaymentOrderTransferTradeNoIndex() {
    const rows = await this.dataSource.query(
      `
        SELECT INDEX_NAME
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'payment_orders'
          AND INDEX_NAME = 'uk_payment_orders_transfer_trade_no'
        LIMIT 1
      `,
    );

    if (rows.length > 0) {
      return;
    }

    const statement = 'CREATE UNIQUE INDEX uk_payment_orders_transfer_trade_no ON payment_orders (transfer_trade_no)';
    await this.dataSource.query(statement);
    this.logger.log(`Applied schema update: ${statement}`);
  }

  private async ensurePaymentOrderChineseText() {
    const amountExpression =
      "TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM CAST(total_amount AS CHAR)))";
    const statements = [
      `
        UPDATE payment_orders
        SET subject = CONCAT('积分充值 ', ${amountExpression}, ' 元')
        WHERE provider IN ('alipay', 'wechat')
          AND subject LIKE 'Points recharge % CNY'
      `,
      `
        UPDATE payment_orders
        SET subject = CONCAT('线下转账积分充值 ', ${amountExpression}, ' 元')
        WHERE provider = 'offline_transfer'
          AND subject LIKE 'Offline transfer points recharge % CNY'
      `,
      "UPDATE payment_orders SET status_message = '订单已创建' WHERE status_message = 'Order created'",
      "UPDATE payment_orders SET status_message = '等待支付' WHERE status_message = 'Waiting for payment'",
      "UPDATE payment_orders SET status_message = '订单码已生成，等待支付' WHERE status_message = 'Order code generated, waiting for payment'",
      "UPDATE payment_orders SET status_message = '微信支付订单码已生成，等待支付' WHERE status_message = 'Wechat Pay order code generated, waiting for payment'",
      "UPDATE payment_orders SET status_message = '交易已关闭' WHERE status_message = 'Trade closed'",
      "UPDATE payment_orders SET status_message = '用户已扫码，等待确认支付' WHERE status_message = 'User scanned, waiting for confirmation'",
      "UPDATE payment_orders SET status_message = '支付成功，积分已到账' WHERE status_message = 'Payment succeeded, points credited'",
      "UPDATE payment_orders SET status_message = '支付宝 app_id 不匹配' WHERE status_message = 'Alipay app_id mismatch'",
      "UPDATE payment_orders SET status_message = '支付宝 seller_id 不匹配' WHERE status_message = 'Alipay seller_id mismatch'",
      "UPDATE payment_orders SET status_message = '支付宝回调金额不匹配' WHERE status_message = 'Alipay notify amount mismatch'",
      "UPDATE payment_orders SET status_message = '支付宝查询订单号不匹配' WHERE status_message = 'Alipay query out_trade_no mismatch'",
      "UPDATE payment_orders SET status_message = '支付宝查询金额不匹配' WHERE status_message = 'Alipay query amount mismatch'",
      "UPDATE payment_orders SET status_message = '微信支付回调金额不匹配' WHERE status_message = 'Wechat Pay notify amount mismatch'",
      "UPDATE payment_orders SET status_message = '微信支付订单号不匹配' WHERE status_message = 'Wechat Pay out_trade_no mismatch'",
      "UPDATE payment_orders SET status_message = '微信支付金额不匹配' WHERE status_message = 'Wechat Pay amount mismatch'",
      "UPDATE payment_orders SET status_message = '微信支付订单已关闭' WHERE status_message = 'Wechat Pay order closed'",
    ];

    for (const statement of statements) {
      await this.dataSource.query(statement);
    }
  }

  private async ensureTimedOutPaymentOrders() {
    await this.dataSource.query(
      `
        UPDATE payment_orders
        SET status = 'EXPIRED',
            status_message = '订单超时',
            closed_at = COALESCE(closed_at, NOW()),
            last_checked_at = NOW()
        WHERE provider IN ('alipay', 'wechat')
          AND status IN ('CREATED', 'QR_READY', 'WAITING_PAYMENT', 'SCANNED')
          AND created_at <= DATE_SUB(NOW(), INTERVAL 3 MINUTE)
      `,
    );
  }

  private async ensureInitialAdminUsers() {
    const usernames = this.parseCsvEnv('INITIAL_ADMIN_USERNAMES');
    const emails = this.parseCsvEnv('INITIAL_ADMIN_EMAILS');

    if (!usernames.length && !emails.length) {
      return;
    }

    if (usernames.length) {
      await this.dataSource.query(
        `UPDATE users SET role = 'admin' WHERE username IN (${usernames.map(() => '?').join(',')})`,
        usernames,
      );
    }

    if (emails.length) {
      await this.dataSource.query(
        `UPDATE users SET role = 'admin' WHERE email IN (${emails.map(() => '?').join(',')})`,
        emails,
      );
    }
  }

  private async ensurePortalAvatarDir() {
    const configuredDir = this.configService.get<string>('CLIENT_PORTAL_AVATAR_DIR');
    const targetDir = configuredDir
      ? resolve(configuredDir)
      : resolve(process.cwd(), '..', 'client-portal', 'avatar');

    await mkdir(targetDir, { recursive: true });
  }

  private async ensurePortalRechargeVoucherDir() {
    const configuredDir = this.configService.get<string>('RECHARGE_VOUCHER_DIR');
    const targetDir = configuredDir
      ? resolve(configuredDir)
      : resolve(process.cwd(), '..', 'client-portal', 'recharge-vouchers');

    await mkdir(targetDir, { recursive: true });
  }

  private parseCsvEnv(key: string) {
    return String(this.configService.get<string>(key) || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
}
