import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import FormData from 'form-data';
import { DataSource } from 'typeorm';
import type { AuthUser } from '../auth/auth-user.interface';
import { WorkflowRunsService } from '../workflow-runs/workflow-runs.service';
import { Wf003ManufacturerLogosService } from './wf003-manufacturer-logos.service';
import { WorkflowsService } from './workflows.service';

const execFileAsync = promisify(execFile);
const ALLOWED_WF002_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;

type Wf003UserMetadata = {
  feishu_app_id: string | null;
  feishu_id: string | null;
};

@Injectable()
export class WorkflowExecutionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly workflowsService: WorkflowsService,
    private readonly workflowRunsService: WorkflowRunsService,
    private readonly dataSource: DataSource,
    private readonly wf003ManufacturerLogosService: Wf003ManufacturerLogosService,
  ) {}

  async execute(
    workflowCode: string,
    currentUser: AuthUser,
    authorizationHeader: string,
    payload: { prompt?: string; image?: string; aspect_ratio?: string },
  ) {
    if (workflowCode === 'WF-001') {
      return this.executeWf001(
        workflowCode,
        currentUser,
        authorizationHeader,
        payload,
      );
    }

    throw new BadRequestException('Execution endpoint currently supports WF-001 only');
  }

  async executeWebhook(
    workflowCode: string,
    currentUser: AuthUser,
    payload: { prompt?: string; aspect_ratio?: string },
  ) {
    if (workflowCode !== 'WF-002') {
      throw new BadRequestException(
        'Webhook execution endpoint currently supports WF-002 only',
      );
    }

    this.workflowsService.getByCodeOrThrow(workflowCode);

    const prompt = payload.prompt?.trim();
    if (!prompt) {
      throw new BadRequestException('prompt is required');
    }
    const aspectRatio = payload.aspect_ratio?.trim() || '1:1';
    if (
      !ALLOWED_WF002_ASPECT_RATIOS.includes(
        aspectRatio as (typeof ALLOWED_WF002_ASPECT_RATIOS)[number],
      )
    ) {
      throw new BadRequestException(
        `aspect_ratio must be one of: ${ALLOWED_WF002_ASPECT_RATIOS.join(', ')}`,
      );
    }

    const webhookUrl =
      this.configService.get<string>('WF_002_WEBHOOK_URL')?.trim() ||
      'https://n8n.deepsix.store/webhook/simple-prompt';
    const webhookTimeoutMs = Number(
      this.configService.get<string>('WF_002_WEBHOOK_TIMEOUT_MS') || '180000',
    );

    if (!webhookUrl) {
      throw new InternalServerErrorException('WF_002_WEBHOOK_URL is not set');
    }

    const clientRequestId = `wf002_exec_${Date.now()}`;
    const requestPayloadSummary = {
      workflow_code: workflowCode,
      prompt_preview: prompt.slice(0, 120),
      aspect_ratio: aspectRatio,
      executor_type: 'n8n_webhook',
      billing_mode: 'fixed_points',
      webhook_url: webhookUrl,
    };

    const registerData = await this.workflowRunsService.register(currentUser, {
      workflow_code: workflowCode,
      client_request_id: clientRequestId,
      request_payload_summary: requestPayloadSummary,
    });

    const runId = registerData.run_id;

    try {
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => {
        abortController.abort();
      }, webhookTimeoutMs);

      const upstreamResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          aspect_ratio: aspectRatio,
          run_id: runId,
          client_request_id: clientRequestId,
          workflow_code: workflowCode,
          user_id: currentUser.userId,
        }),
        signal: abortController.signal,
      });
      clearTimeout(timeoutHandle);

      const rawText = await upstreamResponse.text();
      const rawResponse = this.tryParseJson(rawText);
      const imageUrls = this.extractImageUrls(rawResponse);
      const upstreamStatus = upstreamResponse.status;
      const hasResponseBody = rawText.trim().length > 0;

      if (!upstreamResponse.ok) {
        await this.workflowRunsService.callback({
          run_id: runId,
          workflow_code: workflowCode,
          status: 'failed',
          finished_at: this.formatDateTime(new Date()),
          result_summary: `WF-002 upstream request failed with status=${upstreamStatus}`,
          result_urls: [],
          external_task_id: clientRequestId,
          error_message: hasResponseBody ? rawText.slice(0, 500) : `HTTP ${upstreamStatus}`,
        });

        throw new InternalServerErrorException(
          `WF-002 webhook request failed: HTTP ${upstreamStatus}`,
        );
      }

      const callbackSummary = hasResponseBody
        ? `WF-002 webhook executed successfully, upstream_status=${upstreamStatus}, image_urls=${imageUrls.length}`
        : `WF-002 webhook executed successfully with empty response body, upstream_status=${upstreamStatus}`;

      await this.workflowRunsService.callback({
        run_id: runId,
        workflow_code: workflowCode,
        status: 'success',
        finished_at: this.formatDateTime(new Date()),
        result_summary: callbackSummary,
        result_urls: imageUrls,
        external_task_id: clientRequestId,
      });

      const [workflowRun] = await this.dataSource.query(
        `
          SELECT
            run_id,
            workflow_code,
            client_request_id,
            status,
            billing_status,
            estimated_frozen_points,
            final_charge_points,
            refund_points,
            result_summary,
            result_summary_url,
            result_urls_json,
            started_at,
            finished_at
          FROM workflow_runs
          WHERE user_id = ?
            AND workflow_code = ?
            AND client_request_id = ?
          LIMIT 1
        `,
        [currentUser.userId, workflowCode, clientRequestId],
      );

      return {
        workflow_code: workflowCode,
        client_request_id: clientRequestId,
        run: workflowRun
          ? {
              ...workflowRun,
              result_urls: this.parseJsonArray(workflowRun.result_urls_json),
            }
          : null,
        message: imageUrls.length
          ? 'WF-002 已执行完成，并提取到图片地址。'
          : 'WF-002 已执行完成，但 webhook 未直接返回图片地址。',
        upstream_status: upstreamStatus,
        has_response_body: hasResponseBody,
        raw_response: rawResponse,
        image_urls: imageUrls,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'WF-002 execution failed';
      const normalizedMessage =
        error instanceof Error && error.name === 'AbortError'
          ? `WF-002 webhook timeout after ${webhookTimeoutMs}ms`
          : message;

      const [workflowRun] = await this.dataSource.query(
        `
          SELECT billing_status
          FROM workflow_runs
          WHERE run_id = ?
          LIMIT 1
        `,
        [runId],
      );

      if (workflowRun?.billing_status === 'frozen') {
        await this.workflowRunsService.callback({
          run_id: runId,
          workflow_code: workflowCode,
          status: 'failed',
          finished_at: this.formatDateTime(new Date()),
          result_summary: 'WF-002 failed before completion',
          result_urls: [],
          external_task_id: clientRequestId,
          error_message: normalizedMessage.slice(0, 500),
        });
      }

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new InternalServerErrorException(normalizedMessage);
    }
  }

  async executeUploadWorkflow(
    workflowCode: string,
    currentUser: AuthUser,
    payload: { car_name?: string },
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
    if (workflowCode !== 'WF-003') {
      throw new BadRequestException(
        'Upload execution endpoint currently supports WF-003 only',
      );
    }

    this.workflowsService.getByCodeOrThrow(workflowCode);

    const carName = payload.car_name?.trim();
    if (!carName) {
      throw new BadRequestException('car_name is required');
    }

    const exteriorImages = files.exterior_images ?? [];
    const interiorImages = files.interior_images ?? [];

    if (exteriorImages.length === 0) {
      throw new BadRequestException('At least one exterior image is required');
    }

    if (exteriorImages.length > 5 || interiorImages.length > 5) {
      throw new BadRequestException(
        'exterior_images and interior_images support up to 5 files each',
      );
    }

    const webhookUrl =
      this.configService.get<string>('WF_003_WEBHOOK_URL')?.trim() ||
      'https://n8n.deepsix.store/webhook/wf003-kie-submit';
    const callbackBaseUrl =
      this.configService.get<string>('WF_003_CALLBACK_BASE_URL')?.trim() ||
      this.configService.get<string>('MIDDLE_PLATFORM_PUBLIC_BASE_URL')?.trim();
    const callbackToken =
      this.configService.get<string>('WF_003_CALLBACK_TOKEN')?.trim() || '';
    const webhookTimeoutMs = Number(
      this.configService.get<string>('WF_003_WEBHOOK_TIMEOUT_MS') || '300000',
    );
    const clientRequestId = `wf003_exec_${Date.now()}`;
    const callbackUrl = callbackBaseUrl
      ? `${callbackBaseUrl.replace(/\/$/, '')}/api/v1/workflow-runs/wf003-callback`
      : null;
    const requestPayloadSummary = {
      workflow_code: workflowCode,
      car_name: carName.slice(0, 120),
      exterior_image_count: exteriorImages.length,
      interior_image_count: interiorImages.length,
      executor_type: 'wf003_n8n_webhook',
      billing_mode: 'result_count',
      webhook_url: webhookUrl,
      callback_url: callbackUrl,
    };

    const registerData = await this.workflowRunsService.register(currentUser, {
      workflow_code: workflowCode,
      client_request_id: clientRequestId,
      request_payload_summary: requestPayloadSummary,
    });
    const runId = registerData.run_id;
    const userMetadata = await this.getWf003UserMetadata(currentUser.userId);

    try {
      const formData = new FormData();
      formData.append('car_name', carName);
      formData.append('run_id', runId);
      formData.append('client_request_id', clientRequestId);
      formData.append('workflow_code', workflowCode);
      formData.append('user_id', String(currentUser.userId));
      formData.append('feishu_app_id', userMetadata.feishu_app_id ?? '');
      formData.append('feishu_id', userMetadata.feishu_id ?? '');
      if (callbackUrl) {
        formData.append('callback_url', callbackUrl);
        if (callbackToken) {
          formData.append('callback_token', callbackToken);
        }
      }

      let exteriorIndex = 1;
      let interiorIndex = 1;

      for (const file of exteriorImages) {
        formData.append(
          `exterior_${exteriorIndex}`,
          file.buffer,
          {
            filename: file.originalname || 'exterior.jpg',
            contentType: file.mimetype || 'image/jpeg',
          },
        );
        exteriorIndex += 1;
      }

      for (const file of interiorImages) {
        formData.append(
          `interior_${interiorIndex}`,
          file.buffer,
          {
            filename: file.originalname || 'interior.jpg',
            contentType: file.mimetype || 'image/jpeg',
          },
        );
        interiorIndex += 1;
      }

      const uploadedLogo = files.logo?.[0];
      const defaultLogo = uploadedLogo ?? (await this.loadDefaultWf003Logo());
      formData.append(
        'logo',
        defaultLogo.buffer,
        {
          filename:
            'filename' in defaultLogo
              ? defaultLogo.filename
              : defaultLogo.originalname || 'logo.png',
          contentType: defaultLogo.mimetype,
        },
      );
      formData.append(
        '_file_counts',
        JSON.stringify({
          exterior: exteriorImages.length,
          interior: interiorImages.length,
        }),
      );

      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => {
        abortController.abort();
      }, webhookTimeoutMs);

      const upstreamResponse = await axios.post(webhookUrl, formData, {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        signal: abortController.signal,
        validateStatus: () => true,
      });
      clearTimeout(timeoutHandle);

      const rawText =
        typeof upstreamResponse.data === 'string'
          ? upstreamResponse.data
          : JSON.stringify(upstreamResponse.data);
      const rawResponse = this.tryParseJson(rawText);
      const upstreamStatus = upstreamResponse.status;
      const hasResponseBody = rawText.trim().length > 0;
      const imageUrls = this.extractImageUrls(rawResponse);
      const actualCompletedCount = this.resolveActualCompletedCount(
        rawResponse,
        imageUrls,
      );
      const hasFinalResult = imageUrls.length > 0 || actualCompletedCount > 0;

      if (upstreamStatus >= 400) {
        await this.workflowRunsService.callback({
          run_id: runId,
          workflow_code: workflowCode,
          status: 'failed',
          finished_at: this.formatDateTime(new Date()),
          result_summary: `WF-003 upstream request failed with status=${upstreamStatus}`,
          result_urls: [],
          external_task_id: clientRequestId,
          error_message: hasResponseBody
            ? rawText.slice(0, 500)
            : `HTTP ${upstreamStatus}`,
        });

        throw new InternalServerErrorException(
          `WF-003 upload request failed: HTTP ${upstreamStatus}`,
        );
      }

      let workflowRun = await this.findWorkflowRun(
        currentUser.userId,
        workflowCode,
        clientRequestId,
      );

      if (hasFinalResult) {
        await this.workflowRunsService.callback({
          run_id: runId,
          workflow_code: workflowCode,
          status: 'success',
          finished_at: this.formatDateTime(new Date()),
          actual_completed_count: actualCompletedCount,
          result_summary: `WF-003 completed successfully, generated_images=${actualCompletedCount}`,
          result_summary_url: imageUrls[0] ?? null,
          result_urls: imageUrls,
          external_task_id: clientRequestId,
        });

        workflowRun = await this.findWorkflowRun(
          currentUser.userId,
          workflowCode,
          clientRequestId,
        );
      }

      return {
        workflow_code: workflowCode,
        client_request_id: clientRequestId,
        estimated_count: registerData.estimated_count,
        estimated_frozen_points: registerData.estimated_frozen_points,
        run: workflowRun,
        message: hasFinalResult
          ? 'WF-003 已完成并按生成结果结算。'
          : 'WF-003 已受理，积分已冻结，等待工作流完成后结算。',
        upstream_status: upstreamStatus,
        has_response_body: hasResponseBody,
        raw_response: rawResponse,
        image_urls: imageUrls,
      };

      return {
        workflow_code: workflowCode,
        client_request_id: clientRequestId,
        estimated_count: registerData.estimated_count,
        estimated_frozen_points: registerData.estimated_frozen_points,
        run: workflowRun,
        message: 'WF-003 已受理，积分已冻结，等待工作流完成后回调结算。',
        upstream_status: upstreamStatus,
        has_response_body: hasResponseBody,
        raw_response: rawResponse,
        image_urls: [],
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'WF-003 execution failed';
      const normalizedMessage =
        error instanceof Error && error.name === 'AbortError'
          ? `WF-003 request timeout after ${webhookTimeoutMs}ms`
          : message;

      const [workflowRun] = await this.dataSource.query(
        `
          SELECT billing_status
          FROM workflow_runs
          WHERE run_id = ?
          LIMIT 1
        `,
        [runId],
      );

      if (workflowRun?.billing_status === 'frozen') {
        await this.workflowRunsService.callback({
          run_id: runId,
          workflow_code: workflowCode,
          status: 'failed',
          finished_at: this.formatDateTime(new Date()),
          actual_completed_count: 0,
          result_summary: 'WF-003 failed before completion',
          result_urls: [],
          external_task_id: clientRequestId,
          error_message: normalizedMessage.slice(0, 500),
        });
      }

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new InternalServerErrorException(normalizedMessage);
    }
  }

  async executeJsonWorkflow(
    workflowCode: string,
    currentUser: AuthUser,
    payload: {
      car_name?: string;
      exterior_images?: string[];
      interior_images?: string[];
      source?: string;
      submitted_at?: string;
    },
  ) {
    if (workflowCode !== 'WF-003') {
      throw new BadRequestException(
        'JSON execution endpoint currently supports WF-003 only',
      );
    }

    this.workflowsService.getByCodeOrThrow(workflowCode);

    const carName = payload.car_name?.trim();
    if (!carName) {
      throw new BadRequestException('car_name is required');
    }

    const exteriorImages = (payload.exterior_images ?? [])
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    const interiorImages = (payload.interior_images ?? [])
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);

    if (exteriorImages.length === 0) {
      throw new BadRequestException('At least one exterior image is required');
    }

    if (exteriorImages.length > 5 || interiorImages.length > 5) {
      throw new BadRequestException(
        'exterior_images and interior_images support up to 5 items each',
      );
    }

    const webhookUrl =
      this.configService.get<string>('WF_003_WEBHOOK_URL')?.trim() ||
      'https://n8n.deepsix.store/webhook/wf003-kie-submit';
    const callbackBaseUrl =
      this.configService.get<string>('WF_003_CALLBACK_BASE_URL')?.trim() ||
      this.configService.get<string>('MIDDLE_PLATFORM_PUBLIC_BASE_URL')?.trim();
    const callbackToken =
      this.configService.get<string>('WF_003_CALLBACK_TOKEN')?.trim() || '';
    const webhookTimeoutMs = Number(
      this.configService.get<string>('WF_003_WEBHOOK_TIMEOUT_MS') || '60000',
    );
    const clientRequestId = `wf003_json_${Date.now()}`;
    const callbackUrl = callbackBaseUrl
      ? `${callbackBaseUrl.replace(/\/$/, '')}/api/v1/workflow-runs/wf003-callback`
      : null;

    if (!webhookUrl) {
      throw new InternalServerErrorException('WF_003_WEBHOOK_URL is not set');
    }

    if (!callbackUrl) {
      throw new InternalServerErrorException(
        'WF_003_CALLBACK_BASE_URL or MIDDLE_PLATFORM_PUBLIC_BASE_URL is not set',
      );
    }

    const logoUrl = await this.resolveWf003UserLogoUrl(currentUser.userId);

    const requestPayloadSummary = {
      workflow_code: workflowCode,
      car_name: carName.slice(0, 120),
      exterior_image_count: exteriorImages.length,
      interior_image_count: interiorImages.length,
      logo_source: 'user_bound_logo',
      executor_type: 'wf003_json_webhook',
      billing_mode: 'result_count',
      webhook_url: webhookUrl,
      callback_url: callbackUrl,
      source: payload.source?.trim() || 'wf003_frontend_direct_to_kie',
    };

    const registerData = await this.workflowRunsService.register(currentUser, {
      workflow_code: workflowCode,
      client_request_id: clientRequestId,
      request_payload_summary: requestPayloadSummary,
    });
    const runId = registerData.run_id;
    const userMetadata = await this.getWf003UserMetadata(currentUser.userId);

    try {
      const abortController = new AbortController();
      const timeoutHandle = setTimeout(() => {
        abortController.abort();
      }, webhookTimeoutMs);

      const upstreamResponse = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          car_name: carName,
          exterior_images: exteriorImages,
          interior_images: interiorImages,
          logo: logoUrl,
          source: payload.source?.trim() || 'wf003_frontend_direct_to_kie',
          submitted_at: payload.submitted_at?.trim() || new Date().toISOString(),
          run_id: runId,
          client_request_id: clientRequestId,
          workflow_code: workflowCode,
          user_id: currentUser.userId,
          feishu_app_id: userMetadata.feishu_app_id,
          feishu_id: userMetadata.feishu_id,
          callback_url: callbackUrl,
          callback_token: callbackToken || undefined,
        }),
        signal: abortController.signal,
      });
      clearTimeout(timeoutHandle);

      const rawText = await upstreamResponse.text();
      const rawResponse = this.tryParseJson(rawText);
      const upstreamStatus = upstreamResponse.status;
      const hasResponseBody = rawText.trim().length > 0;

      if (!upstreamResponse.ok) {
        await this.workflowRunsService.callback({
          run_id: runId,
          workflow_code: workflowCode,
          status: 'failed',
          finished_at: this.formatDateTime(new Date()),
          actual_completed_count: 0,
          result_summary: `WF-003 JSON request failed with status=${upstreamStatus}`,
          result_urls: [],
          external_task_id: clientRequestId,
          error_message: hasResponseBody
            ? rawText.slice(0, 500)
            : `HTTP ${upstreamStatus}`,
        });

        throw new InternalServerErrorException(
          `WF-003 json request failed: HTTP ${upstreamStatus}`,
        );
      }

      const workflowRun = await this.findWorkflowRun(
        currentUser.userId,
        workflowCode,
        clientRequestId,
      );

      return {
        workflow_code: workflowCode,
        client_request_id: clientRequestId,
        estimated_count: registerData.estimated_count,
        estimated_frozen_points: registerData.estimated_frozen_points,
        run: workflowRun,
        message: 'WF-003 已受理，积分已冻结，等待工作流完成后回调结算。',
        upstream_status: upstreamStatus,
        has_response_body: hasResponseBody,
        raw_response: rawResponse,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'WF-003 JSON execution failed';
      const normalizedMessage =
        error instanceof Error && error.name === 'AbortError'
          ? `WF-003 json request timeout after ${webhookTimeoutMs}ms`
          : message;

      const [workflowRun] = await this.dataSource.query(
        `
          SELECT billing_status
          FROM workflow_runs
          WHERE run_id = ?
          LIMIT 1
        `,
        [runId],
      );

      if (workflowRun?.billing_status === 'frozen') {
        await this.workflowRunsService.callback({
          run_id: runId,
          workflow_code: workflowCode,
          status: 'failed',
          finished_at: this.formatDateTime(new Date()),
          actual_completed_count: 0,
          result_summary: 'WF-003 JSON execution failed before completion',
          result_urls: [],
          external_task_id: clientRequestId,
          error_message: normalizedMessage.slice(0, 500),
        });
      }

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (error instanceof InternalServerErrorException) {
        throw error;
      }

      throw new InternalServerErrorException(normalizedMessage);
    }
  }

  private async resolveWf003LogoUrl(manufacturerCode: string) {
    try {
      const logo = await this.wf003ManufacturerLogosService.getActiveLogoByCode(
        manufacturerCode,
      );
      return this.wf003ManufacturerLogosService.resolveLogoUrl(logo);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `WF-003 manufacturer logo not found: ${manufacturerCode}`;
      throw new BadRequestException(message);
    }
  }

  private async resolveWf003UserLogoUrl(userId: number) {
    try {
      const logo = await this.wf003ManufacturerLogosService.getMyLogo(userId);
      const publicUrl = logo.logoPublicUrl?.trim();
      if (!publicUrl) {
        throw new BadRequestException(
          `WF-003 logo public URL is not configured for user: ${userId}`,
        );
      }
      return publicUrl;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : `WF-003 logo not found for user: ${userId}`;
      throw new BadRequestException(message);
    }
  }

  private async executeWf001(
    workflowCode: string,
    currentUser: AuthUser,
    authorizationHeader: string,
    payload: { prompt?: string; image?: string; aspect_ratio?: string },
  ) {
    this.workflowsService.getByCodeOrThrow(workflowCode);

    const pythonExecutable =
      this.configService.get<string>('PYTHON_EXECUTABLE') || 'python';
    const scriptPath = this.configService.get<string>('WF_001_SCRIPT_PATH');
    const mockMode =
      this.configService.get<string>('WF_001_MOCK_MODE') || 'success';

    if (!scriptPath) {
      throw new InternalServerErrorException('WF_001_SCRIPT_PATH is not set');
    }

    const aspectRatio = payload.aspect_ratio?.trim() || '1:1';
    if (
      !ALLOWED_WF002_ASPECT_RATIOS.includes(
        aspectRatio as (typeof ALLOWED_WF002_ASPECT_RATIOS)[number],
      )
    ) {
      throw new BadRequestException(
        `aspect_ratio must be one of: ${ALLOWED_WF002_ASPECT_RATIOS.join(', ')}`,
      );
    }

    const clientRequestId = `wf001_exec_${Date.now()}`;
    const args = [
      scriptPath,
      '--client-request-id',
      clientRequestId,
      '--prompt',
      payload.prompt?.trim() || 'Run WF-001 from client portal',
      '--aspect-ratio',
      aspectRatio,
      '--mock-mode',
      mockMode,
    ];

    if (payload.image?.trim()) {
      args.push('--image', payload.image.trim());
    } else {
      args.push('--no-image');
    }

    try {
      const result = await execFileAsync(pythonExecutable, args, {
        cwd: this.resolveWorkflowDirectory(scriptPath),
        env: {
          ...process.env,
          MIDDLE_PLATFORM_BASE: 'http://127.0.0.1:3002/api/v1',
          MIDDLE_PLATFORM_TOKEN: authorizationHeader,
          CALLBACK_SIGNING_SECRET:
            this.configService.get<string>('CALLBACK_SIGNING_SECRET') || '',
        },
        timeout: 600000,
      });

      const [workflowRun] = await this.dataSource.query(
        `
          SELECT
            run_id,
            workflow_code,
            client_request_id,
            status,
            billing_status,
            estimated_frozen_points,
            final_charge_points,
            refund_points,
            result_summary,
            result_summary_url,
            result_urls_json,
            started_at,
            finished_at
          FROM workflow_runs
          WHERE user_id = ?
            AND workflow_code = ?
            AND client_request_id = ?
          LIMIT 1
        `,
        [currentUser.userId, workflowCode, clientRequestId],
      );

      return {
        workflow_code: workflowCode,
        client_request_id: clientRequestId,
        stdout: result.stdout?.trim() ?? '',
        stderr: result.stderr?.trim() ?? '',
        run: workflowRun
          ? {
              ...workflowRun,
              result_urls: this.parseJsonArray(workflowRun.result_urls_json),
            }
          : null,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : 'WF-001 execution failed',
      );
    }
  }

  private resolveWorkflowDirectory(scriptPath: string) {
    const lastSlash = Math.max(
      scriptPath.lastIndexOf('\\'),
      scriptPath.lastIndexOf('/'),
    );
    return lastSlash === -1 ? process.cwd() : scriptPath.slice(0, lastSlash);
  }

  private async getWf003UserMetadata(userId: number): Promise<Wf003UserMetadata> {
    const [binding] = await this.dataSource.query(
      `
        SELECT feishu_app_id, feishu_id
        FROM wf_003_feishu
        WHERE user_id = ?
        LIMIT 1
      `,
      [userId],
    );

    return {
      feishu_app_id:
        typeof binding?.feishu_app_id === 'string' && binding.feishu_app_id.trim()
          ? binding.feishu_app_id.trim()
          : null,
      feishu_id:
        typeof binding?.feishu_id === 'string' && binding.feishu_id.trim()
          ? binding.feishu_id.trim()
          : null,
    };
  }

  private async findWorkflowRun(
    userId: number,
    workflowCode: string,
    clientRequestId: string,
  ) {
    const [workflowRun] = await this.dataSource.query(
      `
        SELECT
          run_id,
          workflow_code,
          client_request_id,
          status,
          billing_status,
          estimated_count,
          actual_completed_count,
          estimated_frozen_points,
          final_charge_points,
          refund_points,
          result_summary,
          result_summary_url,
          result_urls_json,
          started_at,
          finished_at
        FROM workflow_runs
        WHERE user_id = ?
          AND workflow_code = ?
          AND client_request_id = ?
        LIMIT 1
      `,
      [userId, workflowCode, clientRequestId],
    );

    if (!workflowRun) {
      return null;
    }

    return {
      ...workflowRun,
      result_urls: this.parseJsonArray(workflowRun.result_urls_json),
    };
  }

  private async loadDefaultWf003Logo() {
    const configuredPath = this.configService
      .get<string>('WF_003_DEFAULT_LOGO_PATH')
      ?.trim();
    const candidatePaths = [
      configuredPath,
      path.resolve(
        process.cwd(),
        '..',
        'WF-003',
        'car-export-portal',
        'logo',
        'logo.png',
      ),
      path.resolve(
        process.cwd(),
        'WF-003',
        'car-export-portal',
        'logo',
        'logo.png',
      ),
    ].filter((value): value is string => Boolean(value));

    for (const candidatePath of candidatePaths) {
      try {
        const buffer = await readFile(candidatePath);
        return {
          buffer,
          filename: path.basename(candidatePath),
          mimetype: this.getMimeTypeByFileName(candidatePath),
        };
      } catch {
        continue;
      }
    }

    throw new InternalServerErrorException(
      'WF-003 default logo file is not available',
    );
  }

  private parseJsonArray(value: unknown) {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }

    if (typeof value !== 'string' || !value.trim()) {
      return [];
    }

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private tryParseJson(value: string) {
    if (!value.trim()) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private extractImageUrls(value: unknown, collected: string[] = []) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      const lowered = trimmed.toLowerCase();

      if (
        trimmed.startsWith('http') &&
        (lowered.endsWith('.png') ||
          lowered.endsWith('.jpg') ||
          lowered.endsWith('.jpeg') ||
          lowered.endsWith('.webp') ||
          lowered.endsWith('.gif') ||
          lowered.includes('.png?') ||
          lowered.includes('.jpg?') ||
          lowered.includes('.jpeg?') ||
          lowered.includes('.webp?') ||
          lowered.includes('.gif?'))
      ) {
        collected.push(trimmed);
        return collected;
      }

      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          this.extractImageUrls(JSON.parse(trimmed), collected);
        } catch {
          return collected;
        }
      }

      return collected;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        this.extractImageUrls(item, collected);
      }
      return collected;
    }

    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) {
        this.extractImageUrls(item, collected);
      }
    }

    return [...new Set(collected)];
  }

  private resolveActualCompletedCount(value: unknown, imageUrls: string[]) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }

    if (value && typeof value === 'object') {
      const recordValue = value as Record<string, unknown>;
      const directCount = Number(
        recordValue.actual_completed_count ??
          recordValue.completed_count ??
          recordValue.generated_images_count ??
          recordValue.generated_image_count ??
          recordValue.generated_count ??
          recordValue.image_count ??
          recordValue.images_count ??
          recordValue.result_count ??
          recordValue.output_count,
      );

      if (Number.isFinite(directCount) && directCount >= 0) {
        return Math.floor(directCount);
      }

      for (const item of Object.values(recordValue)) {
        const nestedCount = this.resolveActualCompletedCount(item, imageUrls);
        if (nestedCount > 0) {
          return nestedCount;
        }
      }
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const nestedCount = this.resolveActualCompletedCount(item, imageUrls);
        if (nestedCount > 0) {
          return nestedCount;
        }
      }
    }

    return imageUrls.length;
  }

  private getMimeTypeByFileName(fileName: string) {
    const normalized = fileName.toLowerCase();

    if (normalized.endsWith('.png')) {
      return 'image/png';
    }

    if (normalized.endsWith('.webp')) {
      return 'image/webp';
    }

    if (normalized.endsWith('.gif')) {
      return 'image/gif';
    }

    return 'image/jpeg';
  }

  private formatDateTime(value: Date) {
    const pad = (input: number) => String(input).padStart(2, '0');

    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
}
