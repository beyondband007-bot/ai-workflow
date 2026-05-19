import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDecipheriv, createSign, createVerify, randomBytes } from 'crypto';
import { readFileSync } from 'fs';

type WechatPayConfig = {
  appId: string;
  mchId: string;
  serialNo: string;
  apiV3Key: string;
  privateKey: string;
  platformPublicKey: string;
  notifyUrl: string;
  apiBaseUrl: string;
};

export type WechatPayQueryResult = {
  appid?: string;
  mchid?: string;
  out_trade_no?: string;
  transaction_id?: string;
  trade_state?: string;
  trade_state_desc?: string;
  amount?: {
    total?: number;
    payer_total?: number;
    currency?: string;
    payer_currency?: string;
  };
};

@Injectable()
export class WechatPayClientService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured() {
    try {
      const config = this.getConfig();
      return Boolean(config.appId && config.mchId && config.serialNo && config.apiV3Key && config.privateKey);
    } catch {
      return false;
    }
  }

  async createNativeOrder(input: {
    outTradeNo: string;
    description: string;
    totalCents: number;
    expireMinutes: number;
  }): Promise<{ code_url: string }> {
    const config = this.getConfig();
    const response = await this.callWechatPay<{ code_url?: string }>('POST', '/v3/pay/transactions/native', {
      appid: config.appId,
      mchid: config.mchId,
      description: input.description,
      out_trade_no: input.outTradeNo,
      time_expire: this.formatWechatPayExpireTime(input.expireMinutes),
      notify_url: config.notifyUrl,
      amount: {
        total: input.totalCents,
        currency: 'CNY',
      },
    });

    if (!response.code_url) {
      throw new ServiceUnavailableException('Wechat Pay did not return code_url');
    }
    return { code_url: response.code_url };
  }

  async queryOrder(outTradeNo: string) {
    const config = this.getConfig();
    return this.callWechatPay<WechatPayQueryResult>(
      'GET',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(config.mchId)}`,
    );
  }

  decryptNotifyResource(resource: {
    associated_data?: string;
    nonce?: string;
    ciphertext?: string;
  }): WechatPayQueryResult {
    const config = this.getConfig();
    if (!resource?.nonce || !resource?.ciphertext) {
      throw new BadRequestException('Invalid Wechat Pay notify resource');
    }

    const key = Buffer.from(config.apiV3Key, 'utf8');
    if (key.length !== 32) {
      throw new ServiceUnavailableException('WECHAT_PAY_API_V3_KEY must be 32 bytes');
    }

    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    const authTag = encrypted.subarray(encrypted.length - 16);
    const payload = encrypted.subarray(0, encrypted.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(resource.nonce, 'utf8'));
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from(resource.associated_data || '', 'utf8'));

    const plaintext = Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext);
  }

  verifyNotifySignature(input: {
    timestamp?: string | string[];
    nonce?: string | string[];
    signature?: string | string[];
    bodyText?: string;
  }) {
    const config = this.getConfig();
    const timestamp = this.firstHeaderValue(input.timestamp);
    const nonce = this.firstHeaderValue(input.nonce);
    const signature = this.firstHeaderValue(input.signature);
    if (!timestamp || !nonce || !signature || !input.bodyText || !config.platformPublicKey) {
      return false;
    }

    const message = `${timestamp}\n${nonce}\n${input.bodyText}\n`;
    return createVerify('RSA-SHA256').update(message).verify(config.platformPublicKey, signature, 'base64');
  }

  private async callWechatPay<T>(method: 'GET' | 'POST', pathWithQuery: string, body?: Record<string, unknown>) {
    const config = this.getConfig();
    const bodyText = body ? JSON.stringify(body) : '';
    const authorization = this.buildAuthorization(method, pathWithQuery, bodyText, config);
    const response = await fetch(`${config.apiBaseUrl}${pathWithQuery}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: authorization,
        'Content-Type': 'application/json',
        'User-Agent': 'ai-workflow-payments/1.0',
      },
      body: bodyText || undefined,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const message = data?.message || data?.code || `Wechat Pay request failed: ${response.status}`;
      const error = new ServiceUnavailableException(message) as ServiceUnavailableException & { wechatCode?: string };
      error.wechatCode = data?.code;
      throw error;
    }

    return data as T;
  }

  private buildAuthorization(method: string, pathWithQuery: string, bodyText: string, config: WechatPayConfig) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString('hex');
    const message = `${method}\n${pathWithQuery}\n${timestamp}\n${nonce}\n${bodyText}\n`;
    const signature = createSign('RSA-SHA256').update(message).sign(config.privateKey, 'base64');

    const authorizationParams = [
      `mchid="${config.mchId}"`,
      `nonce_str="${nonce}"`,
      `signature="${signature}"`,
      `timestamp="${timestamp}"`,
      `serial_no="${config.serialNo}"`,
    ].join(',');

    return `WECHATPAY2-SHA256-RSA2048 ${authorizationParams}`;
  }

  private getConfig(): WechatPayConfig {
    const publicBaseUrl =
      this.configService.get<string>('MIDDLE_PLATFORM_PUBLIC_BASE_URL') ||
      this.configService.get<string>('WF_003_CALLBACK_BASE_URL') ||
      '';
    const privateKey =
      this.normalizePrivateKey(this.configService.get<string>('WECHAT_PAY_PRIVATE_KEY')) ||
      this.readPrivateKeyFile(this.configService.get<string>('WECHAT_PAY_PRIVATE_KEY_PATH'));

    return {
      appId:
        this.configService.get<string>('WECHAT_PAY_APP_ID') ||
        this.configService.get<string>('WECHAT_PAY_APPID') ||
        '',
      mchId:
        this.configService.get<string>('WECHAT_PAY_MCH_ID') ||
        this.configService.get<string>('WECHAT_PAY_MCHID') ||
        '',
      serialNo:
        this.configService.get<string>('WECHAT_PAY_MERCHANT_SERIAL_NO') ||
        this.configService.get<string>('WECHAT_PAY_CERT_SERIAL_NO') ||
        '',
      apiV3Key:
        this.configService.get<string>('WECHAT_PAY_API_V3_KEY') ||
        this.readSecretFile(this.configService.get<string>('WECHAT_PAY_API_V3_KEY_PATH')).trim(),
      privateKey,
      platformPublicKey:
        this.normalizePublicKey(this.configService.get<string>('WECHAT_PAY_PLATFORM_PUBLIC_KEY')) ||
        this.readSecretFile(this.configService.get<string>('WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH')),
      notifyUrl:
        this.configService.get<string>('WECHAT_PAY_NOTIFY_URL') ||
        (publicBaseUrl ? `${publicBaseUrl.replace(/\/$/, '')}/api/v1/wechatpay/notify` : ''),
      apiBaseUrl: this.configService.get<string>('WECHAT_PAY_API_BASE_URL') || 'https://api.mch.weixin.qq.com',
    };
  }

  private normalizePrivateKey(value?: string) {
    return value?.trim().replace(/\\n/g, '\n') || '';
  }

  private normalizePublicKey(value?: string) {
    return value?.trim().replace(/\\n/g, '\n') || '';
  }

  private firstHeaderValue(value?: string | string[]) {
    return Array.isArray(value) ? value[0] : value;
  }

  private formatWechatPayExpireTime(expireMinutes: number) {
    const expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000);
    return expiresAt.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  }

  private readPrivateKeyFile(path?: string) {
    return this.readSecretFile(path);
  }

  private readSecretFile(path?: string) {
    if (!path?.trim()) {
      return '';
    }
    try {
      return readFileSync(path.trim(), 'utf8');
    } catch {
      return '';
    }
  }
}
