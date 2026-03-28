import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
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
}
