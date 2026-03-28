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
import { WorkflowsService } from './workflows.service';

const execFileAsync = promisify(execFile);

@Injectable()
export class WorkflowExecutionService {
  constructor(
    private readonly configService: ConfigService,
    private readonly workflowsService: WorkflowsService,
    private readonly dataSource: DataSource,
  ) {}

  async execute(
    workflowCode: string,
    currentUser: AuthUser,
    authorizationHeader: string,
    payload: { prompt?: string; image?: string },
  ) {
    if (workflowCode !== 'WF-001') {
      throw new BadRequestException('Execution endpoint currently supports WF-001 only');
    }

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
}
