import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { AuthUser } from '../auth/auth-user.interface';
import { PointAccountsService } from '../point-accounts/point-accounts.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { WorkflowDefinition } from '../workflows/workflow-definition.interface';

type RegisterPayload = {
  workflow_code?: string;
  client_request_id?: string;
  request_payload_summary?: Record<string, unknown>;
};

type CallbackPayload = {
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
};

@Injectable()
export class WorkflowRunsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly workflowsService: WorkflowsService,
    private readonly pointAccountsService: PointAccountsService,
  ) {}

  async register(currentUser: AuthUser, payload: RegisterPayload) {
    const workflowCode = payload.workflow_code?.trim();
    const clientRequestId = payload.client_request_id?.trim();

    if (!workflowCode) {
      throw new BadRequestException('workflow_code is required');
    }

    if (!clientRequestId) {
      throw new BadRequestException('client_request_id is required');
    }

    const workflow = this.workflowsService.getByCodeOrThrow(workflowCode);
    const requestPayloadSummary = payload.request_payload_summary ?? {};

    const existingRun = await this.findExistingRun(
      currentUser.userId,
      workflowCode,
      clientRequestId,
    );

    if (existingRun) {
      return {
        run_id: existingRun.run_id,
        register_status: 'approved',
        estimated_count: existingRun.estimated_count,
        estimated_frozen_points: existingRun.estimated_frozen_points,
      };
    }

    const estimate = this.calculateEstimate(workflow, requestPayloadSummary);
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const pointAccount = await this.pointAccountsService.ensurePointAccount(
        currentUser.userId,
        queryRunner,
      );

      if (pointAccount.available_points < estimate.estimatedFrozenPoints) {
        throw new BadRequestException(
          `Insufficient points: available ${pointAccount.available_points}, required ${estimate.estimatedFrozenPoints}`,
        );
      }

      const runId = this.createRunId();
      const nextAvailablePoints =
        pointAccount.available_points - estimate.estimatedFrozenPoints;
      const nextFrozenPoints =
        pointAccount.frozen_points + estimate.estimatedFrozenPoints;

      await queryRunner.query(
        `
          UPDATE point_accounts
          SET available_points = ?,
              frozen_points = ?
          WHERE user_id = ?
        `,
        [nextAvailablePoints, nextFrozenPoints, currentUser.userId],
      );

      await queryRunner.query(
        `
          INSERT INTO workflow_runs (
            run_id,
            user_id,
            workflow_code,
            client_request_id,
            status,
            billing_status,
            estimated_count,
            estimated_frozen_points,
            request_payload_summary
          ) VALUES (?, ?, ?, ?, 'running', 'frozen', ?, ?, ?)
        `,
        [
          runId,
          currentUser.userId,
          workflow.workflow_code,
          clientRequestId,
          estimate.estimatedCount,
          estimate.estimatedFrozenPoints,
          JSON.stringify(requestPayloadSummary),
        ],
      );

      await queryRunner.query(
        `
          INSERT INTO points_transactions (
            user_id,
            type,
            points,
            balance_after,
            remark
          ) VALUES (?, 'freeze', ?, ?, ?)
        `,
        [
          currentUser.userId,
          -estimate.estimatedFrozenPoints,
          nextAvailablePoints,
          `${workflow.workflow_code} register freeze for run ${runId}`,
        ],
      );

      await queryRunner.commitTransaction();

      return {
        run_id: runId,
        register_status: 'approved',
        estimated_count: estimate.estimatedCount,
        estimated_frozen_points: estimate.estimatedFrozenPoints,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getMyRuns(currentUser: AuthUser) {
    const runs = await this.dataSource.query(
      `
        SELECT
          run_id,
          workflow_code,
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
          external_task_id,
          error_message,
          started_at,
          finished_at,
          created_at
        FROM workflow_runs
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 50
      `,
      [currentUser.userId],
    );

    return runs.map((run: Record<string, unknown>) => ({
      ...run,
      result_urls: this.parseJsonArray(run.result_urls_json),
    }));
  }

  async callback(payload: CallbackPayload) {
    const runId = payload.run_id?.trim();
    const workflowCode = payload.workflow_code?.trim();
    const callbackStatus = payload.status;

    if (!runId) {
      throw new BadRequestException('run_id is required');
    }

    if (!workflowCode) {
      throw new BadRequestException('workflow_code is required');
    }

    if (!callbackStatus) {
      throw new BadRequestException('status is required');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const [run] = await queryRunner.query(
        `
          SELECT
            id,
            run_id,
            user_id,
            workflow_code,
            status,
            billing_status,
            estimated_count,
            estimated_frozen_points,
            final_charge_points,
            refund_points
          FROM workflow_runs
          WHERE run_id = ?
          LIMIT 1
        `,
        [runId],
      );

      if (!run) {
        throw new NotFoundException(`Run ${runId} not found`);
      }

      if (run.workflow_code !== workflowCode) {
        throw new BadRequestException('workflow_code does not match run');
      }

      if (run.billing_status !== 'frozen') {
        return {
          run_id: run.run_id,
          status: run.status,
          billing_status: run.billing_status,
          final_charge_points: Number(run.final_charge_points ?? 0),
          refund_points: Number(run.refund_points ?? 0),
        };
      }

      const workflow = this.workflowsService.getByCodeOrThrow(workflowCode);
      const pointAccount = await this.pointAccountsService.ensurePointAccount(
        Number(run.user_id),
        queryRunner,
      );
      const estimatedFrozenPoints = Number(run.estimated_frozen_points ?? 0);
      const resultUrls = payload.result_urls?.filter((item) => typeof item === 'string' && item.trim()) ?? [];

      let nextStatus = callbackStatus;
      let nextBillingStatus: 'charged' | 'rollback' = 'rollback';
      let finalChargePoints = 0;
      let refundPoints = 0;
      let actualCompletedCount: number | null = null;
      let nextAvailablePoints = pointAccount.available_points;
      let nextFrozenPoints = pointAccount.frozen_points - estimatedFrozenPoints;
      let nextTotalConsumed = pointAccount.total_consumed_points;

      if (nextFrozenPoints < 0) {
        throw new BadRequestException('Frozen points state is invalid');
      }

      if (callbackStatus === 'success') {
        if (workflow.workflow_code === 'WF-001' && resultUrls.length === 0) {
          nextStatus = 'failed';
          refundPoints = estimatedFrozenPoints;
          nextBillingStatus = 'rollback';
          actualCompletedCount = 0;
          nextAvailablePoints += refundPoints;
        } else {
        const settlement = this.calculateSettlement(
          workflow,
          Number(run.estimated_count ?? 0),
          estimatedFrozenPoints,
          payload.actual_completed_count,
        );

          finalChargePoints = settlement.finalChargePoints;
          refundPoints = settlement.refundPoints;
          actualCompletedCount = settlement.actualCompletedCount;
          nextBillingStatus = 'charged';
          nextAvailablePoints += refundPoints;
          nextTotalConsumed += finalChargePoints;
        }
      } else {
        refundPoints = estimatedFrozenPoints;
        nextBillingStatus = 'rollback';
        nextAvailablePoints += refundPoints;
        actualCompletedCount = Number(payload.actual_completed_count ?? 0);
      }

      await queryRunner.query(
        `
          UPDATE point_accounts
          SET available_points = ?,
              frozen_points = ?,
              total_consumed_points = ?
          WHERE user_id = ?
        `,
        [
          nextAvailablePoints,
          nextFrozenPoints,
          nextTotalConsumed,
          Number(run.user_id),
        ],
      );

      await queryRunner.query(
        `
          UPDATE workflow_runs
          SET status = ?,
              billing_status = ?,
              actual_completed_count = ?,
              final_charge_points = ?,
              refund_points = ?,
              result_summary = ?,
              result_summary_url = ?,
              result_urls_json = ?,
              external_task_id = ?,
              error_message = ?,
              finished_at = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE run_id = ?
        `,
        [
          nextStatus,
          nextBillingStatus,
          actualCompletedCount,
          finalChargePoints,
          refundPoints,
          payload.result_summary ?? null,
          payload.result_summary_url ?? resultUrls[0] ?? null,
          JSON.stringify(resultUrls),
          payload.external_task_id ?? null,
          payload.error_message ??
            (workflow.workflow_code === 'WF-001' &&
            callbackStatus === 'success' &&
            resultUrls.length === 0
              ? 'WF-001 returned success but no image URLs were produced'
              : null),
          payload.finished_at ?? this.formatDateTime(new Date()),
          runId,
        ],
      );

      if (nextBillingStatus === 'charged') {
        await queryRunner.query(
          `
            INSERT INTO points_transactions (
              user_id,
              type,
              points,
              balance_after,
              remark
            ) VALUES (?, 'charge', ?, ?, ?)
          `,
          [
            Number(run.user_id),
            -finalChargePoints,
            nextAvailablePoints,
            `${workflow.workflow_code} final charge ${finalChargePoints} for run ${runId}`,
          ],
        );
      }

      if (refundPoints > 0) {
        await queryRunner.query(
          `
            INSERT INTO points_transactions (
              user_id,
              type,
              points,
              balance_after,
              remark
            ) VALUES (?, 'rollback', ?, ?, ?)
          `,
          [
            Number(run.user_id),
            refundPoints,
            nextAvailablePoints,
            `${workflow.workflow_code} refund ${refundPoints} for run ${runId}`,
          ],
        );
      }

      await queryRunner.query(
        `
          INSERT INTO api_call_logs (
            user_id,
            api_name,
            request_summary,
            points_cost,
            status
          ) VALUES (?, ?, ?, ?, ?)
        `,
        [
          Number(run.user_id),
          workflow.workflow_code,
          payload.result_summary ?? `${workflow.workflow_code} callback`,
          finalChargePoints,
          callbackStatus,
        ],
      );

      await queryRunner.commitTransaction();

      return {
        run_id: runId,
        status: nextStatus,
        billing_status: nextBillingStatus,
        final_charge_points: finalChargePoints,
        refund_points: refundPoints,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async findExistingRun(
    userId: number,
    workflowCode: string,
    clientRequestId: string,
  ) {
    const [existingRun] = await this.dataSource.query(
      `
        SELECT run_id, estimated_count, estimated_frozen_points
        FROM workflow_runs
        WHERE user_id = ?
          AND workflow_code = ?
          AND client_request_id = ?
        LIMIT 1
      `,
      [userId, workflowCode, clientRequestId],
    );

    return existingRun;
  }

  private calculateEstimate(
    workflow: WorkflowDefinition,
    requestPayloadSummary: Record<string, unknown>,
  ) {
    if (workflow.workflow_code === 'WF-003') {
      const exteriorCount = this.normalizeCount(
        requestPayloadSummary.exterior_image_count,
        5,
      );
      const interiorInputCount = this.normalizeCount(
        requestPayloadSummary.interior_image_count,
        5,
      );
      const interiorOutputCount =
        interiorInputCount === 0 ? 0 : interiorInputCount <= 3 ? 1 : 2;
      const estimatedCount = Math.min(
        exteriorCount + interiorOutputCount,
        workflow.max_estimated_count,
      );
      const estimatedFrozenPoints = Math.min(
        estimatedCount * (workflow.unit_points ?? 0),
        workflow.max_frozen_points,
      );

      return {
        estimatedCount,
        estimatedFrozenPoints,
      };
    }

    return {
      estimatedCount: workflow.max_estimated_count,
      estimatedFrozenPoints: workflow.max_frozen_points,
    };
  }

  private normalizeCount(value: unknown, max: number) {
    const normalized = Number(value ?? 0);

    if (Number.isNaN(normalized) || normalized < 0) {
      return 0;
    }

    return Math.min(Math.floor(normalized), max);
  }

  private createRunId() {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const timestamp = [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      pad(now.getHours()),
      pad(now.getMinutes()),
      pad(now.getSeconds()),
    ].join('');
    const suffix = Math.random().toString(36).slice(2, 8);

    return `run_${timestamp}_${suffix}`;
  }

  private calculateSettlement(
    workflow: WorkflowDefinition,
    estimatedCount: number,
    estimatedFrozenPoints: number,
    actualCompletedCountValue: number | undefined,
  ) {
    if (workflow.workflow_code === 'WF-003') {
      const actualCompletedCount = this.normalizeCount(
        actualCompletedCountValue,
        workflow.max_estimated_count,
      );
      const finalChargePoints = Math.min(
        actualCompletedCount * (workflow.unit_points ?? 0),
        estimatedFrozenPoints,
      );

      return {
        actualCompletedCount,
        finalChargePoints,
        refundPoints: estimatedFrozenPoints - finalChargePoints,
      };
    }

    return {
      actualCompletedCount: estimatedCount,
      finalChargePoints: estimatedFrozenPoints,
      refundPoints: 0,
    };
  }

  private formatDateTime(value: Date) {
    const pad = (input: number) => String(input).padStart(2, '0');

    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
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
