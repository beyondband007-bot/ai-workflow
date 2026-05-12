import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { Wf003ManufacturerLogo } from './wf003-manufacturer-logo.entity';

@Injectable()
export class Wf003ManufacturerLogosService {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Wf003ManufacturerLogo)
    private readonly manufacturerLogoRepository: Repository<Wf003ManufacturerLogo>,
  ) {}

  async listActive(request?: Request) {
    const logos = await this.manufacturerLogoRepository.find({
      where: { isActive: true },
      order: {
        manufacturerName: 'ASC',
        manufacturerCode: 'ASC',
      },
    });

    return logos.map((logo) => ({
      manufacturer_code: logo.manufacturerCode,
      manufacturer_name: logo.manufacturerName,
      logo_file_name: logo.logoFileName,
      logo_mime_type: logo.logoMimeType,
      logo_sha256: logo.logoSha256,
      logo_url: this.resolveLogoUrl(logo, request),
    }));
  }

  async getActiveLogoByCode(manufacturerCode: string) {
    const normalizedCode = this.normalizeManufacturerCode(manufacturerCode);
    const logo = await this.manufacturerLogoRepository.findOne({
      where: {
        manufacturerCode: normalizedCode,
        isActive: true,
      },
    });

    if (!logo) {
      throw new NotFoundException(
        `WF-003 manufacturer logo not found: ${normalizedCode}`,
      );
    }

    return logo;
  }

  async getMyLogo(userId: number) {
    const logo = await this.manufacturerLogoRepository.findOne({
      where: {
        userId,
        isActive: true,
      },
    });

    if (!logo) {
      throw new NotFoundException(
        `WF-003 logo not found for user: ${userId}`,
      );
    }

    return logo;
  }

  async checkUserAccess(userId: number): Promise<{
    hasAccess: boolean;
    logoPublicUrl: string | null;
    businessContact: { phone: string; wechat: string };
  }> {
    const logo = await this.manufacturerLogoRepository.findOne({
      where: {
        userId,
        isActive: true,
      },
    });

    return {
      hasAccess: !!logo && !!logo.logoPublicUrl?.trim(),
      logoPublicUrl: logo?.logoPublicUrl?.trim() || null,
      businessContact: {
        phone: this.configService.get<string>('WF_003_BUSINESS_CONTACT_PHONE')?.trim() || '',
        wechat: this.configService.get<string>('WF_003_BUSINESS_CONTACT_WECHAT')?.trim() || '',
      },
    };
  }

  buildPublicLogoUrl(manufacturerCode: string, request?: Request) {
    const baseUrl = this.resolvePublicBaseUrl(request);
    const encodedCode = encodeURIComponent(
      this.normalizeManufacturerCode(manufacturerCode),
    );

    return `${baseUrl}/api/v1/wf003/manufacturers/${encodedCode}/logo`;
  }

  resolveLogoUrl(logo: Wf003ManufacturerLogo, request?: Request) {
    const publicUrl = logo.logoPublicUrl?.trim();
    if (publicUrl && !this.isEphemeralTempfileUrl(publicUrl)) {
      return publicUrl;
    }

    return this.buildPublicLogoUrl(logo.manufacturerCode, request);
  }

  private normalizeManufacturerCode(manufacturerCode: string) {
    return manufacturerCode.trim().toLowerCase();
  }

  private isEphemeralTempfileUrl(url: string) {
    try {
      const parsed = new URL(url);
      return parsed.hostname === 'tempfile.redpandaai.co';
    } catch {
      return false;
    }
  }

  private resolvePublicBaseUrl(request?: Request) {
    const configuredBaseUrl =
      this.configService.get<string>('MIDDLE_PLATFORM_PUBLIC_BASE_URL')?.trim() ||
      this.configService.get<string>('WF_003_CALLBACK_BASE_URL')?.trim();

    if (configuredBaseUrl) {
      return configuredBaseUrl.replace(/\/$/, '');
    }

    if (request) {
      return `${request.protocol}://${request.get('host')}`.replace(/\/$/, '');
    }

    return 'http://127.0.0.1:3002';
  }
}
