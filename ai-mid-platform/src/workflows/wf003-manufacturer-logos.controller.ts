import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Wf003ManufacturerLogosService } from './wf003-manufacturer-logos.service';

@Controller('api/v1/wf003')
export class Wf003ManufacturerLogosController {
  constructor(
    private readonly manufacturerLogosService: Wf003ManufacturerLogosService,
  ) {}

  @Get('manufacturers')
  listManufacturers(@Req() request: Request) {
    return this.manufacturerLogosService.listActive(request);
  }

  @Get('manufacturers/:manufacturerCode/logo')
  async getLogo(
    @Param('manufacturerCode') manufacturerCode: string,
    @Res() response: Response,
  ) {
    const logo =
      await this.manufacturerLogosService.getActiveLogoByCode(manufacturerCode);

    response.setHeader('Content-Type', logo.logoMimeType || 'image/png');
    response.setHeader('Cache-Control', 'public, max-age=3600');

    if (logo.logoSha256) {
      response.setHeader('ETag', `"${logo.logoSha256}"`);
    }

    response.end(logo.logoContent);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-logo')
  async getMyLogo(@CurrentUser() currentUser: AuthUser) {
    const logo = await this.manufacturerLogosService.getMyLogo(currentUser.userId);
    return {
      manufacturer_code: logo.manufacturerCode,
      manufacturer_name: logo.manufacturerName,
      logo_file_name: logo.logoFileName,
      logo_mime_type: logo.logoMimeType,
      logo_public_url: logo.logoPublicUrl,
      logo_sha256: logo.logoSha256,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('access')
  async checkAccess(@CurrentUser() currentUser: AuthUser) {
    const access = await this.manufacturerLogosService.checkUserAccess(currentUser.userId);
    return {
      has_access: access.hasAccess,
      logo_public_url: access.logoPublicUrl,
      business_contact: access.businessContact,
    };
  }
}
