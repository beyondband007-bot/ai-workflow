import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CallbackSignatureService } from './callback-signature.service';
import { WorkflowRunsService } from './workflow-runs.service';

@Controller('api/v1/workflow-runs')
export class WorkflowRunsController {
  constructor(
    private readonly workflowRunsService: WorkflowRunsService,
    private readonly callbackSignatureService: CallbackSignatureService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  getMyRuns(@CurrentUser() currentUser: AuthUser) {
    return this.workflowRunsService.getMyRuns(currentUser);
  }

  @UseGuards(JwtAuthGuard)
  @Post('register')
  register(
    @CurrentUser() currentUser: AuthUser,
    @Body()
    body: {
      workflow_code?: string;
      client_request_id?: string;
      request_payload_summary?: Record<string, unknown>;
    },
  ) {
    return this.workflowRunsService.register(currentUser, body);
  }

  @Post('callback')
  callback(
    @Headers('x-callback-timestamp') callbackTimestamp: string,
    @Headers('x-callback-signature') callbackSignature: string,
    @Body()
    body: {
      run_id?: string;
      workflow_code?: string;
      status?: 'success' | 'failed' | 'timeout' | 'cancelled';
      finished_at?: string;
      actual_completed_count?: number;
      result_summary?: string;
      result_summary_url?: string;
      result_urls?: string[];
      external_task_id?: string;
      error_message?: string;
    },
  ) {
    this.callbackSignatureService.verify(body, callbackTimestamp, callbackSignature);
    return this.workflowRunsService.callback(body);
  }

  @Post('wf003-callback')
  wf003Callback(
    @Headers('x-workflow-callback-token') workflowCallbackToken: string,
    @Body()
    body: {
      run_id?: string;
      workflow_code?: string;
      status?: 'success' | 'failed' | 'timeout' | 'cancelled';
      finished_at?: string;
      actual_completed_count?: number;
      result_summary?: string;
      result_summary_url?: string;
      result_urls?: string[];
      external_task_id?: string;
      error_message?: string;
    },
  ) {
    this.callbackSignatureService.verifyWf003CallbackToken(workflowCallbackToken);
    return this.workflowRunsService.callback(body);
  }
}
