import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkflowExecutionService } from './workflow-execution.service';
import { WorkflowsService } from './workflows.service';

@Controller('api/v1/workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly workflowExecutionService: WorkflowExecutionService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  getWorkflows() {
    return this.workflowsService.getAll();
  }

  @UseGuards(JwtAuthGuard)
  @Post(':workflowCode/execute')
  executeWorkflow(
    @Param('workflowCode') workflowCode: string,
    @CurrentUser() currentUser: AuthUser,
    @Req() request: Request,
    @Body() body: { prompt?: string; image?: string },
  ) {
    return this.workflowExecutionService.execute(
      workflowCode,
      currentUser,
      request.headers.authorization || '',
      body,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':workflowCode/webhook-execute')
  executeWebhookWorkflow(
    @Param('workflowCode') workflowCode: string,
    @CurrentUser() currentUser: AuthUser,
    @Body() body: { prompt?: string },
  ) {
    return this.workflowExecutionService.executeWebhook(
      workflowCode,
      currentUser,
      body,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':workflowCode/upload-execute')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'exterior_images', maxCount: 5 },
      { name: 'interior_images', maxCount: 5 },
      { name: 'logo', maxCount: 1 },
    ]),
  )
  executeUploadWorkflow(
    @Param('workflowCode') workflowCode: string,
    @CurrentUser() currentUser: AuthUser,
    @Body() body: { car_name?: string },
    @UploadedFiles()
    files: {
      exterior_images?: Array<{
        buffer: Buffer;
        originalname: string;
        mimetype: string;
      }>;
      interior_images?: Array<{
        buffer: Buffer;
        originalname: string;
        mimetype: string;
      }>;
      logo?: Array<{
        buffer: Buffer;
        originalname: string;
        mimetype: string;
      }>;
    },
  ) {
    return this.workflowExecutionService.executeUploadWorkflow(
      workflowCode,
      currentUser,
      body,
      files,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':workflowCode/json-execute')
  executeJsonWorkflow(
    @Param('workflowCode') workflowCode: string,
    @CurrentUser() currentUser: AuthUser,
    @Body()
    body: {
      car_name?: string;
      exterior_images?: string[];
      interior_images?: string[];
      manufacturer_code?: string;
      source?: string;
      submitted_at?: string;
    },
  ) {
    return this.workflowExecutionService.executeJsonWorkflow(
      workflowCode,
      currentUser,
      body,
    );
  }
}
