import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Wf003ManufacturerLogosService } from './wf003-manufacturer-logos.service';

@Controller('api/v1/wf003/manufacturers')
export class Wf003ManufacturerLogosController {
  constructor(
    private readonly manufacturerLogosService: Wf003ManufacturerLogosService,
  ) {}

  @Get()
  listManufacturers(@Req() request: Request) {
    return this.manufacturerLogosService.listActive(request);
  }

  @Get(':manufacturerCode/logo')
  async getLogo(
    @Param('manufacturerCode') manufacturerCode: string,
    @Res() response: Response,
  ) {
    const logo =
      await this.manufacturerLogosService.getActiveLogoByCode(manufacturerCode);

    response.setHeader('Content-Type', logo.logoMimeType);
    response.setHeader('Cache-Control', 'public, max-age=3600');

    if (logo.logoSha256) {
      response.setHeader('ETag', `"${logo.logoSha256}"`);
    }

    response.end(logo.logoContent);
  }
}
