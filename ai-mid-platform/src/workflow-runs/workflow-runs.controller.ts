import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    private readonly configService: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  getMyRuns(@CurrentUser() currentUser: AuthUser) {
    return this.workflowRunsService.getMyRuns(currentUser);
  }

  @UseGuards(JwtAuthGuard)
  @Get('query')
  getMyRunsQuery(
    @CurrentUser() currentUser: AuthUser,
    @Query()
    query: {
      page?: string;
      page_size?: string;
      start_time?: string;
      end_time?: string;
      status?: string;
      order_no?: string;
    },
  ) {
    return this.workflowRunsService.getMyRunsQuery(currentUser, query);
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

  @UseGuards(JwtAuthGuard)
  @Post('callback-auth')
  callbackAuth(
    @CurrentUser() currentUser: AuthUser,
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
    return this.workflowRunsService.callbackAuth(currentUser, body);
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

  @Post('wf003-kie-callback-proxy')
  async wf003KieCallbackProxy(@Body() body: Record<string, unknown>) {
    const workerBaseUrl =
      this.configService.get<string>('WF_003_WORKER_BASE_URL')?.trim() ||
      'http://wf003-worker:3013';
    const targetUrl = `${workerBaseUrl.replace(/\/$/, '')}/webhook/wf003-kie-callback`;

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const rawText = await response.text();
      const parsed = rawText ? this.tryParseJson(rawText) : null;

      if (!response.ok) {
        throw new BadGatewayException({
          message: 'WF-003 worker callback proxy failed',
          status: response.status,
          response: parsed,
        });
      }

      return parsed;
    } catch (error) {
      if (error instanceof BadGatewayException) {
        throw error;
      }

      throw new BadGatewayException(
        error instanceof Error ? error.message : 'WF-003 worker callback proxy failed',
      );
    }
  }

  @Post('wf003-state/register-task')
  wf003RegisterTask(
    @Headers('x-workflow-callback-token') workflowCallbackToken: string,
    @Body()
    body: {
      submissionId?: string;
      run_id?: string;
      workflow_code?: string;
      client_request_id?: string;
      user_id?: string;
      callback_url?: string;
      callback_token?: string;
      car_name?: string;
      logo?: string;
      feishu_app_id?: string;
      feishu_id?: string;
      expectedTasks?: number;
      taskId?: string;
      type?: 'exterior' | 'interior';
      index?: number;
      groupIndex?: number;
      imageUrl?: string;
      imageUrls?: string[];
    },
  ) {
    this.callbackSignatureService.verifyWf003CallbackToken(workflowCallbackToken);
    return this.workflowRunsService.wf003RegisterTask(body);
  }

  @Post('wf003-state/update-submission-state')
  wf003UpdateSubmissionState(
    @Headers('x-workflow-callback-token') workflowCallbackToken: string,
    @Body()
    body: {
      taskId?: string;
      state?: string;
      rawState?: string;
      resultUrl?: string | null;
      failCode?: string | null;
      failMsg?: string | null;
      body?: Record<string, unknown>;
    },
  ) {
    this.callbackSignatureService.verifyWf003CallbackToken(workflowCallbackToken);
    return this.workflowRunsService.wf003UpdateSubmissionState(body);
  }

  @Post('wf003-state/build-final-assets')
  wf003BuildFinalAssets(
    @Headers('x-workflow-callback-token') workflowCallbackToken: string,
    @Body()
    body: {
      submissionId?: string;
      finalizeToken?: string | null;
    },
  ) {
    this.callbackSignatureService.verifyWf003CallbackToken(workflowCallbackToken);
    return this.workflowRunsService.wf003BuildFinalAssets(body);
  }

  private tryParseJson(value: string) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}
