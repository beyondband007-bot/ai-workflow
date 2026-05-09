import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign, createVerify } from 'crypto';
import { readFileSync } from 'fs';

const SANDBOX_GATEWAY = 'https://openapi-sandbox.dl.alipaydev.com/gateway.do';
const PRODUCTION_GATEWAY = 'https://openapi.alipay.com/gateway.do';

type AlipayParams = Record<string, string | number | undefined | null>;

@Injectable()
export class AlipayClientService {
  constructor(private readonly configService: ConfigService) {}

  getPublicBaseUrl() {
    return (
      this.configService.get<string>('MIDDLE_PLATFORM_PUBLIC_BASE_URL') ||
      this.configService.get<string>('WF_003_CALLBACK_BASE_URL') ||
      ''
    ).replace(/\/+$/, '');
  }

  getAppId() {
    return this.configService.get<string>('ALIPAY_APP_ID') || '';
  }

  getSellerId() {
    return this.configService.get<string>('ALIPAY_SELLER_ID') || '';
  }

  getGateway() {
    return this.configService.get<string>('ALIPAY_ENV') === 'production'
      ? PRODUCTION_GATEWAY
      : SANDBOX_GATEWAY;
  }

  isConfigured() {
    return Boolean(
      this.getAppId() &&
        this.getPublicBaseUrl() &&
        this.configService.get<string>('ALIPAY_PRIVATE_KEY_PATH') &&
        this.configService.get<string>('ALIPAY_PUBLIC_KEY_PATH'),
    );
  }

  buildPrecreateParams(bizContent: Record<string, unknown>) {
    return this.buildBaseParams('alipay.trade.precreate', {
      notify_url: `${this.getPublicBaseUrl()}/api/v1/alipay/notify`,
      biz_content: JSON.stringify(bizContent),
    });
  }

  buildQueryParams(bizContent: Record<string, unknown>) {
    return this.buildBaseParams('alipay.trade.query', {
      biz_content: JSON.stringify(bizContent),
    });
  }

  async call(params: AlipayParams) {
    this.assertConfigured();
    const signedParams = {
      ...params,
      sign: this.signParams(params, this.readPrivateKey()),
    };
    const body = new URLSearchParams();

    Object.entries(signedParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        body.append(key, String(value));
      }
    });

    const response = await fetch(this.getGateway(), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body: body.toString(),
    });
    const rawText = await response.text();
    const data = JSON.parse(rawText) as Record<string, unknown>;
    const responseKey = Object.keys(data).find((key) => key.endsWith('_response'));
    if (!responseKey) {
      throw new InternalServerErrorException('Invalid Alipay response');
    }
    const responseSign = data.sign;
    if (typeof responseSign !== 'string' || !this.verifyResponseSign(rawText, responseKey, responseSign)) {
      throw new InternalServerErrorException('Invalid Alipay response signature');
    }
    const responseBody = (responseKey ? data[responseKey] : data) as Record<string, string>;

    if (responseBody.code !== '10000') {
      const error = new Error(responseBody.sub_msg || responseBody.msg || 'Alipay API error');
      Object.assign(error, {
        code: responseBody.code,
        subCode: responseBody.sub_code,
        subMsg: responseBody.sub_msg,
      });
      throw error;
    }

    return responseBody;
  }

  verifyNotifyParams(params: Record<string, string>) {
    const signature = params.sign;
    if (!signature) {
      return false;
    }
    const signContent = this.buildSignContent(params);
    return createVerify('RSA-SHA256')
      .update(signContent, 'utf8')
      .verify(this.readPublicKey(), signature, 'base64');
  }

  private buildBaseParams(method: string, extra: AlipayParams) {
    return {
      app_id: this.getAppId(),
      method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: this.formatTimestamp(),
      version: '1.0',
      ...extra,
    };
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException('Alipay is not configured');
    }
  }

  private signParams(params: AlipayParams, privateKey: string) {
    const signContent = this.buildSignContent(params);
    return createSign('RSA-SHA256').update(signContent, 'utf8').sign(privateKey, 'base64');
  }

  private buildSignContent(params: AlipayParams) {
    return Object.keys(params)
      .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
      .filter((key) => key !== 'sign')
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');
  }

  private verifyResponseSign(rawText: string, responseKey: string, signature: string) {
    const signContent = this.extractResponseSignContent(rawText, responseKey);
    return createVerify('RSA-SHA256')
      .update(signContent, 'utf8')
      .verify(this.readPublicKey(), signature, 'base64');
  }

  private extractResponseSignContent(rawText: string, responseKey: string) {
    const keyIndex = rawText.indexOf(`"${responseKey}"`);
    if (keyIndex < 0) {
      throw new InternalServerErrorException('Missing Alipay response body');
    }

    const colonIndex = rawText.indexOf(':', keyIndex + responseKey.length + 2);
    if (colonIndex < 0) {
      throw new InternalServerErrorException('Invalid Alipay response body');
    }

    let start = colonIndex + 1;
    while (start < rawText.length && /\s/.test(rawText[start])) {
      start += 1;
    }

    const opener = rawText[start];
    const closer = opener === '{' ? '}' : opener === '[' ? ']' : '';
    if (!closer) {
      throw new InternalServerErrorException('Unsupported Alipay response body');
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < rawText.length; index += 1) {
      const char = rawText[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === opener) {
        depth += 1;
      } else if (char === closer) {
        depth -= 1;
        if (depth === 0) {
          return rawText.slice(start, index + 1);
        }
      }
    }

    throw new InternalServerErrorException('Unterminated Alipay response body');
  }

  private readPrivateKey() {
    const keyPath = this.configService.getOrThrow<string>('ALIPAY_PRIVATE_KEY_PATH');
    return this.normalizePem(readFileSync(keyPath, 'utf8'), 'PRIVATE KEY');
  }

  private readPublicKey() {
    const keyPath = this.configService.getOrThrow<string>('ALIPAY_PUBLIC_KEY_PATH');
    return this.normalizePem(readFileSync(keyPath, 'utf8'), 'PUBLIC KEY');
  }

  private normalizePem(value: string, label: 'PRIVATE KEY' | 'PUBLIC KEY') {
    const trimmed = value.trim().replace(/\\n/g, '\n');
    if (trimmed.includes('BEGIN')) {
      return trimmed;
    }
    const body = trimmed.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') || '';
    return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
  }

  private formatTimestamp(date = new Date()) {
    const pad = (value: number) => String(value).padStart(2, '0');
    return [
      date.getFullYear(),
      '-',
      pad(date.getMonth() + 1),
      '-',
      pad(date.getDate()),
      ' ',
      pad(date.getHours()),
      ':',
      pad(date.getMinutes()),
      ':',
      pad(date.getSeconds()),
    ].join('');
  }
}
