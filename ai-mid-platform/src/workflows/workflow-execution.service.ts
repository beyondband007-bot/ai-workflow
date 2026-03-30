import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
import type { AuthUser } from '../auth/auth-user.interface';
import { WorkflowRunsService } from '../workflow-runs/workflow-runs.service';
import { WorkflowsService } from './workflows.service';

const execFileAsync = promisify(execFile);
const ALLOWED_WF002_ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const;

@Injectable()
export class WorkflowExecutionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly workflowsService: WorkflowsService,
    private readonly workflowRunsService: WorkflowRunsService,
    private readonly dataSource: DataSource,
  ) {}

  async execute(
    workflowCode: string,
    currentUser: AuthUser,
    authorizationHeader: string,
    payload: { prompt?: string; image?: string },
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

    const webhookUrl = this.configService
      .get<string>('WF_002_WEBHOOK_URL')
      ?.trim();
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

  private async executeWf001(
    workflowCode: string,
    currentUser: AuthUser,
    authorizationHeader: string,
    payload: { prompt?: string; image?: string },
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

    const clientRequestId = `wf001_exec_${Date.now()}`;
    const args = [
      scriptPath,
      '--client-request-id',
      clientRequestId,
      '--prompt',
      payload.prompt?.trim() || 'Run WF-001 from client portal',
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

  private formatDateTime(value: Date) {
    const pad = (input: number) => String(input).padStart(2, '0');

    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
}
