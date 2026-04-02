import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class CallbackSignatureService {
  constructor(private readonly configService: ConfigService) {}

  verifyWf003CallbackToken(token: string) {
    const expectedToken = this.configService
      .get<string>('WF_003_CALLBACK_TOKEN')
      ?.trim();

    if (!expectedToken) {
      return;
    }

    if (!token || token.trim() !== expectedToken) {
      throw new UnauthorizedException('Invalid WF-003 callback token');
    }
  }

  verify(payload: Record<string, unknown>, timestamp: string, signature: string) {
    const secret = this.configService.get<string>('CALLBACK_SIGNING_SECRET')?.trim();
    if (!secret) {
      return;
    }

    if (!timestamp) {
      throw new UnauthorizedException('Missing callback timestamp');
    }

    if (!signature) {
      throw new UnauthorizedException('Missing callback signature');
    }

    const timestampValue = Number(timestamp);
    if (!Number.isFinite(timestampValue)) {
      throw new BadRequestException('Invalid callback timestamp');
    }

    const toleranceSeconds = Number(
      this.configService.get<string>('CALLBACK_SIGNING_TOLERANCE_SECONDS') ?? '300',
    );

    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTimestamp - timestampValue) > toleranceSeconds) {
      throw new UnauthorizedException('Callback timestamp expired');
    }

    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${this.stableStringify(payload)}`)
      .digest('hex');

    const providedBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');

    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid callback signature');
    }
  }

  private stableStringify(value: unknown): string {
    return JSON.stringify(this.sortValue(value));
  }

  private sortValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sortValue(item));
    }

    if (value && typeof value === 'object') {
      return Object.keys(value as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((result, key) => {
          result[key] = this.sortValue((value as Record<string, unknown>)[key]);
          return result;
        }, {});
    }

    return value;
  }
}
