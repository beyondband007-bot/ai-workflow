import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
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

type RunsQueryPayload = {
  page?: string;
  page_size?: string;
  start_time?: string;
  end_time?: string;
  status?: string;
  order_no?: string;
  workflow_code?: string;
};

type Wf003RegisterTaskPayload = {
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
};

type Wf003TaskCallbackPayload = {
  taskId?: string;
  state?: string;
  rawState?: string;
  resultUrl?: string | null;
  failCode?: string | null;
  failMsg?: string | null;
  body?: Record<string, unknown>;
};

type Wf003BuildFinalPayload = {
  submissionId?: string;
  finalizeToken?: string | null;
};

@Injectable()
export class WorkflowRunsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowRunsService.name);
  private readonly runExpirationMinutes = 30;
  private readonly expirationScanIntervalMs = 60_000;
  private expirationTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly workflowsService: WorkflowsService,
    private readonly pointAccountsService: PointAccountsService,
  ) {}

  onModuleInit() {
    this.scanExpiredRunsSafely();
    this.expirationTimer = setInterval(
      () => this.scanExpiredRunsSafely(),
      this.expirationScanIntervalMs,
    );
    this.expirationTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.expirationTimer) {
      clearInterval(this.expirationTimer);
      this.expirationTimer = null;
    }
  }

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
        expires_at: existingRun.expires_at,
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
      const expiresAt = this.createRunExpiresAt();
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
            expires_at,
            request_payload_summary
          ) VALUES (?, ?, ?, ?, 'running', 'frozen', ?, ?, ?, ?)
        `,
        [
          runId,
          currentUser.userId,
          workflow.workflow_code,
          clientRequestId,
          estimate.estimatedCount,
          estimate.estimatedFrozenPoints,
          this.formatDateTime(expiresAt),
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
        expires_at: this.formatDateTime(expiresAt),
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
          request_payload_summary,
          external_task_id,
          error_message,
          started_at,
          expires_at,
          finished_at,
          created_at
        FROM workflow_runs
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 10
      `,
      [currentUser.userId],
    );

    return runs.map((run: Record<string, unknown>) => ({
      ...run,
      result_urls: this.parseJsonArray(run.result_urls_json),
      request_payload_summary: this.parseJsonObject(run.request_payload_summary),
    }));
  }

  async getMyRunsQuery(currentUser: AuthUser, query: RunsQueryPayload) {
    const page = this.normalizePage(query.page);
    const pageSize = this.normalizePageSize(query.page_size, 20);
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ['user_id = ?'];
    const params: unknown[] = [currentUser.userId];

    const startTime = this.normalizeDateTime(query.start_time);
    if (startTime) {
      conditions.push(
        'COALESCE(finished_at, started_at, created_at) >= ?',
      );
      params.push(startTime);
    }

    const endTime = this.normalizeDateTime(query.end_time);
    if (endTime) {
      conditions.push(
        'COALESCE(finished_at, started_at, created_at) <= ?',
      );
      params.push(endTime);
    }

    const status = this.normalizeStatus(query.status);
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    const workflowCode = (query.workflow_code ?? '').trim();
    if (workflowCode) {
      conditions.push('workflow_code = ?');
      params.push(workflowCode);
    }

    const orderNo = (query.order_no ?? '').trim();
    if (orderNo) {
      const pattern = `%${orderNo}%`;
      conditions.push(
        '(run_id LIKE ? OR IFNULL(client_request_id, \'\') LIKE ?)',
      );
      params.push(pattern, pattern);
    }

    const whereClause = conditions.join(' AND ');

    const [countRow] = await this.dataSource.query(
      `
        SELECT COUNT(1) AS total
        FROM workflow_runs
        WHERE ${whereClause}
      `,
      params,
    );

    const total = Number(countRow?.total ?? 0);

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
          request_payload_summary,
          external_task_id,
          error_message,
          started_at,
          expires_at,
          finished_at,
          created_at
        FROM workflow_runs
        WHERE ${whereClause}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `,
      [...params, pageSize, offset],
    );

    return {
      page,
      page_size: pageSize,
      total,
      items: runs.map((run: Record<string, unknown>) => ({
        ...run,
        result_urls: this.parseJsonArray(run.result_urls_json),
        request_payload_summary: this.parseJsonObject(run.request_payload_summary),
      })),
    };
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
          FOR UPDATE
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

  async callbackAuth(currentUser: AuthUser, payload: CallbackPayload) {
    const runId = payload.run_id?.trim();

    if (!runId) {
      throw new BadRequestException('run_id is required');
    }

    const [run] = await this.dataSource.query(
      `
        SELECT user_id
        FROM workflow_runs
        WHERE run_id = ?
        LIMIT 1
      `,
      [runId],
    );

    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }

    if (Number(run.user_id) !== currentUser.userId) {
      throw new ForbiddenException('run_id does not belong to current user');
    }

    return this.callback(payload);
  }

  async expireExpiredRuns(limit = 100) {
    const expiredRuns = await this.dataSource.query(
      `
        SELECT run_id, workflow_code
        FROM workflow_runs
        WHERE status = 'running'
          AND billing_status = 'frozen'
          AND COALESCE(expires_at, DATE_ADD(started_at, INTERVAL ? MINUTE)) <= CURRENT_TIMESTAMP
        ORDER BY id ASC
        LIMIT ?
      `,
      [this.runExpirationMinutes, limit],
    );

    let expiredCount = 0;

    for (const run of expiredRuns as Array<{ run_id: string; workflow_code: string }>) {
      try {
        await this.callback({
          run_id: run.run_id,
          workflow_code: run.workflow_code,
          status: 'failed',
          finished_at: this.formatDateTime(new Date()),
          actual_completed_count: 0,
          result_summary: `${run.workflow_code} expired after ${this.runExpirationMinutes} minutes`,
          error_message: `Order expired after ${this.runExpirationMinutes} minutes`,
        });
        expiredCount += 1;
      } catch (error) {
        this.logger.error(
          `Failed to expire workflow run ${run.run_id}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return { expired_count: expiredCount };
  }

  async wf003RegisterTask(payload: Wf003RegisterTaskPayload) {
    const submissionId = (payload.submissionId ?? '').trim();
    const taskId = (payload.taskId ?? '').trim();
    const taskType = (payload.type ?? '').trim();

    if (!submissionId) {
      throw new BadRequestException('submissionId is required');
    }

    if (!taskId) {
      throw new BadRequestException('taskId is required');
    }

    if (!taskType || !['exterior', 'interior'].includes(taskType)) {
      throw new BadRequestException('type must be exterior or interior');
    }

    await this.dataSource.query(
      `
        INSERT INTO wf003_submissions (
          submission_id,
          run_id,
          workflow_code,
          client_request_id,
          user_id,
          callback_url,
          callback_token,
          car_name,
          logo,
          feishu_app_id,
          feishu_id,
          expected_tasks,
          finalized,
          finalize_in_progress,
          finalize_token
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, NULL)
        ON DUPLICATE KEY UPDATE
          run_id = VALUES(run_id),
          workflow_code = VALUES(workflow_code),
          client_request_id = VALUES(client_request_id),
          user_id = VALUES(user_id),
          callback_url = COALESCE(NULLIF(VALUES(callback_url), ''), callback_url),
          callback_token = COALESCE(NULLIF(VALUES(callback_token), ''), callback_token),
          car_name = COALESCE(NULLIF(VALUES(car_name), ''), car_name),
          logo = COALESCE(NULLIF(VALUES(logo), ''), logo),
          feishu_app_id = COALESCE(NULLIF(VALUES(feishu_app_id), ''), feishu_app_id),
          feishu_id = COALESCE(NULLIF(VALUES(feishu_id), ''), feishu_id),
          expected_tasks = GREATEST(expected_tasks, VALUES(expected_tasks)),
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        submissionId,
        (payload.run_id ?? submissionId).trim(),
        (payload.workflow_code ?? 'WF-003').trim() || 'WF-003',
        (payload.client_request_id ?? '').trim(),
        (payload.user_id ?? '').trim(),
        (payload.callback_url ?? '').trim(),
        (payload.callback_token ?? '').trim(),
        (payload.car_name ?? '').trim(),
        (payload.logo ?? '').trim(),
        (payload.feishu_app_id ?? '').trim(),
        (payload.feishu_id ?? '').trim(),
        Math.max(0, Number(payload.expectedTasks ?? 0) || 0),
      ],
    );

    await this.dataSource.query(
      `
        INSERT INTO wf003_tasks (
          task_id,
          submission_id,
          type,
          task_index,
          group_index,
          image_url,
          image_urls_json,
          state,
          result_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', NULL)
        ON DUPLICATE KEY UPDATE
          submission_id = VALUES(submission_id),
          type = VALUES(type),
          task_index = VALUES(task_index),
          group_index = VALUES(group_index),
          image_url = VALUES(image_url),
          image_urls_json = VALUES(image_urls_json),
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        taskId,
        submissionId,
        taskType,
        payload.index ?? null,
        payload.groupIndex ?? null,
        payload.imageUrl ?? null,
        JSON.stringify(payload.imageUrls ?? []),
      ],
    );

    return {
      ok: true,
      submissionId,
      taskId,
      type: taskType,
      index: payload.index ?? null,
      groupIndex: payload.groupIndex ?? null,
    };
  }

  async wf003UpdateSubmissionState(payload: Wf003TaskCallbackPayload) {
    const taskId = (payload.taskId ?? '').trim();
    if (!taskId) {
      throw new BadRequestException('taskId is required');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const [taskMeta] = await queryRunner.query(
        `
          SELECT
            task_id,
            submission_id,
            type,
            state,
            result_url
          FROM wf003_tasks
          WHERE task_id = ?
          LIMIT 1
        `,
        [taskId],
      );

      if (!taskMeta) {
        await queryRunner.commitTransaction();
        return {
          ok: false,
          accepted: true,
          reason: 'task_not_found',
          taskId,
          isComplete: false,
          shouldFinalize: false,
        };
      }

      const submissionId = String(taskMeta.submission_id);
      const [submission] = await queryRunner.query(
        `
          SELECT
            submission_id,
            expected_tasks,
            finalized,
            finalize_in_progress,
            finalize_token
          FROM wf003_submissions
          WHERE submission_id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [submissionId],
      );

      if (!submission) {
        await queryRunner.commitTransaction();
        return {
          ok: false,
          accepted: true,
          reason: 'submission_not_found',
          submissionId,
          taskId,
          isComplete: false,
          shouldFinalize: false,
        };
      }

      const expectedTasks = Number(submission.expected_tasks ?? 0);
      const alreadyFinalized = Number(submission.finalized ?? 0) === 1;
      if (alreadyFinalized) {
        const counts = await this.getWf003TaskCounts(queryRunner, submissionId);
        await queryRunner.commitTransaction();
        return {
          ok: true,
          accepted: true,
          submissionId,
          taskId,
          taskType: taskMeta.type,
          state: taskMeta.state || payload.state || null,
          resultUrl: taskMeta.result_url || payload.resultUrl || null,
          expectedTasks,
          resolvedCount: counts.resolvedCount,
          successCount: counts.successCount,
          failedCount: counts.failedCount,
          isComplete: false,
          shouldFinalize: false,
          reason: 'already_finalized',
        };
      }

      const terminalStates = new Set(['success', 'failed', 'error']);
      const existingState = String(taskMeta.state ?? '');
      const existingResultUrl = taskMeta.result_url
        ? String(taskMeta.result_url)
        : '';
      const alreadyResolved =
        terminalStates.has(existingState) || Boolean(existingResultUrl);

      if (alreadyResolved) {
        const counts = await this.getWf003TaskCounts(queryRunner, submissionId);
        await queryRunner.commitTransaction();
        return {
          ok: true,
          accepted: true,
          submissionId,
          taskId,
          taskType: taskMeta.type,
          state: existingState,
          resultUrl: existingResultUrl || null,
          expectedTasks,
          resolvedCount: counts.resolvedCount,
          successCount: counts.successCount,
          failedCount: counts.failedCount,
          isComplete: counts.resolvedCount >= expectedTasks,
          shouldFinalize: false,
          reason: 'duplicate_callback',
        };
      }

      await queryRunner.query(
        `
          UPDATE wf003_tasks
          SET state = ?,
              raw_state = ?,
              result_url = ?,
              fail_code = ?,
              fail_msg = ?,
              callback_payload_json = ?,
              last_callback_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
          WHERE task_id = ?
        `,
        [
          String(payload.state ?? '').trim() || 'unknown',
          String(payload.rawState ?? '').trim() || null,
          payload.resultUrl ?? null,
          payload.failCode ?? null,
          payload.failMsg ?? null,
          JSON.stringify(payload.body ?? {}),
          taskId,
        ],
      );

      const counts = await this.getWf003TaskCounts(queryRunner, submissionId);
      const isComplete = counts.resolvedCount >= expectedTasks;
      let shouldFinalize = false;
      let finalizeToken = submission.finalize_token
        ? String(submission.finalize_token)
        : null;

      if (
        isComplete &&
        Number(submission.finalized ?? 0) === 0 &&
        Number(submission.finalize_in_progress ?? 0) === 0
      ) {
        shouldFinalize = true;
        finalizeToken = `fin_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        await queryRunner.query(
          `
            UPDATE wf003_submissions
            SET finalize_in_progress = 1,
                finalize_token = ?,
                finalize_requested_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE submission_id = ?
          `,
          [finalizeToken, submissionId],
        );
      } else {
        await queryRunner.query(
          `
            UPDATE wf003_submissions
            SET updated_at = CURRENT_TIMESTAMP
            WHERE submission_id = ?
          `,
          [submissionId],
        );
      }

      await queryRunner.commitTransaction();

      return {
        ok: true,
        accepted: true,
        submissionId,
        taskId,
        taskType: taskMeta.type,
        state: String(payload.state ?? '').trim() || 'unknown',
        resultUrl: payload.resultUrl ?? null,
        failCode: payload.failCode ?? null,
        failMsg: payload.failMsg ?? null,
        expectedTasks,
        resolvedCount: counts.resolvedCount,
        successCount: counts.successCount,
        failedCount: counts.failedCount,
        isComplete,
        shouldFinalize,
        finalizeToken,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async wf003BuildFinalAssets(payload: Wf003BuildFinalPayload) {
    const submissionId = (payload.submissionId ?? '').trim();
    if (!submissionId) {
      throw new BadRequestException('submissionId is required');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const [submission] = await queryRunner.query(
        `
          SELECT
            submission_id,
            run_id,
            workflow_code,
            client_request_id,
            callback_url,
            callback_token,
            car_name,
            feishu_app_id,
            feishu_id,
            finalized,
            finalize_in_progress,
            finalize_token
          FROM wf003_submissions
          WHERE submission_id = ?
          LIMIT 1
          FOR UPDATE
        `,
        [submissionId],
      );

      if (!submission) {
        await queryRunner.commitTransaction();
        return { skipFinalize: true, reason: 'submission_not_found', submissionId };
      }

      if (Number(submission.finalized ?? 0) === 1) {
        await queryRunner.commitTransaction();
        return { skipFinalize: true, reason: 'already_finalized', submissionId };
      }

      if (
        Number(submission.finalize_in_progress ?? 0) !== 1 ||
        !submission.finalize_token
      ) {
        await queryRunner.commitTransaction();
        return { skipFinalize: true, reason: 'finalize_not_claimed', submissionId };
      }

      const finalizeToken = (payload.finalizeToken ?? '').trim();
      if (finalizeToken && finalizeToken !== String(submission.finalize_token)) {
        await queryRunner.commitTransaction();
        return {
          skipFinalize: true,
          reason: 'finalize_token_mismatch',
          submissionId,
        };
      }

      const tasks = await queryRunner.query(
        `
          SELECT
            task_id,
            type,
            task_index,
            group_index,
            state,
            result_url,
            fail_code,
            fail_msg
          FROM wf003_tasks
          WHERE submission_id = ?
        `,
        [submissionId],
      );

      const normalizedCallbackUrlForNotify = /^https?:\/\//i.test(
        String(submission.callback_url ?? '').trim(),
      )
        ? String(submission.callback_url ?? '').trim()
        : 'https://www.getrueai.com/api/v1/workflow-runs/wf003-callback';

      const exteriorImages = (tasks as Array<Record<string, unknown>>)
        .filter(
          (task) =>
            task.type === 'exterior' &&
            task.state === 'success' &&
            Boolean(task.result_url),
        )
        .sort(
          (a, b) => Number(a.task_index ?? 0) - Number(b.task_index ?? 0),
        )
        .map((task, index) => ({
          originalIndex: Number(task.task_index ?? 0) || null,
          imageUrl: String(task.result_url),
          fileName: `exterior_${index + 1}.jpg`,
          taskId: String(task.task_id),
        }));

      const interiorImages = (tasks as Array<Record<string, unknown>>)
        .filter(
          (task) =>
            task.type === 'interior' &&
            task.state === 'success' &&
            Boolean(task.result_url),
        )
        .sort(
          (a, b) => Number(a.group_index ?? 0) - Number(b.group_index ?? 0),
        )
        .map((task, index) => ({
          groupIndex: Number(task.group_index ?? 0) || null,
          imageUrl: String(task.result_url),
          fileName: `interior_${index + 1}.jpg`,
          taskId: String(task.task_id),
        }));

      const failedTasks = (tasks as Array<Record<string, unknown>>)
        .filter((task) => ['failed', 'error'].includes(String(task.state ?? '')))
        .map((task) => ({
          type: String(task.type ?? ''),
          index: Number(task.task_index ?? task.group_index ?? 0) || null,
          taskId: String(task.task_id),
          failCode: task.fail_code ? String(task.fail_code) : null,
          failMsg: task.fail_msg ? String(task.fail_msg) : null,
        }));

      await queryRunner.query(
        `
          UPDATE wf003_submissions
          SET finalized = 1,
              finalized_at = CURRENT_TIMESTAMP,
              finalize_in_progress = 0,
              updated_at = CURRENT_TIMESTAMP
          WHERE submission_id = ?
        `,
        [submissionId],
      );

      await queryRunner.commitTransaction();

      return {
        skipFinalize: false,
        submissionId,
        run_id: String(submission.run_id ?? submissionId),
        workflow_code: String(submission.workflow_code ?? 'WF-003'),
        client_request_id: String(submission.client_request_id ?? ''),
        callback_url: normalizedCallbackUrlForNotify,
        callback_token: String(submission.callback_token ?? ''),
        car_name: String(submission.car_name ?? ''),
        feishu_app_id: String(submission.feishu_app_id ?? ''),
        feishu_id: String(submission.feishu_id ?? ''),
        exteriorImages,
        interiorImages,
        totalExterior: exteriorImages.length,
        totalInterior: interiorImages.length,
        successCount: exteriorImages.length + interiorImages.length,
        failedCount: failedTasks.length,
        failedTasks,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async getWf003TaskCounts(queryRunner: QueryRunner, submissionId: string) {
    const [counts] = await queryRunner.query(
      `
        SELECT
          SUM(
            CASE
              WHEN state IN ('success', 'failed', 'error')
                   OR (result_url IS NOT NULL AND result_url <> '')
              THEN 1 ELSE 0
            END
          ) AS resolved_count,
          SUM(
            CASE
              WHEN state = 'success'
                   AND (result_url IS NOT NULL AND result_url <> '')
              THEN 1 ELSE 0
            END
          ) AS success_count,
          SUM(
            CASE
              WHEN state IN ('failed', 'error')
              THEN 1 ELSE 0
            END
          ) AS failed_count
        FROM wf003_tasks
        WHERE submission_id = ?
      `,
      [submissionId],
    );

    return {
      resolvedCount: Number(counts?.resolved_count ?? 0),
      successCount: Number(counts?.success_count ?? 0),
      failedCount: Number(counts?.failed_count ?? 0),
    };
  }

  private async findExistingRun(
    userId: number,
    workflowCode: string,
    clientRequestId: string,
  ) {
    const [existingRun] = await this.dataSource.query(
      `
        SELECT run_id, estimated_count, estimated_frozen_points, expires_at
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

  private normalizePage(value: unknown) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 1;
    }

    return Math.floor(parsed);
  }

  private normalizePageSize(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return fallback;
    }

    return Math.min(Math.floor(parsed), 100);
  }

  private normalizeStatus(value: unknown) {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized === 'all') {
      return null;
    }

    const allowed = new Set([
      'success',
      'running',
      'failed',
      'timeout',
      'cancelled',
    ]);

    return allowed.has(normalized) ? normalized : null;
  }

  private scanExpiredRunsSafely() {
    void this.expireExpiredRuns().catch((error) => {
      this.logger.error(
        'Failed to scan expired workflow runs',
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  private normalizeDateTime(value: unknown) {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return null;
    }

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return this.formatDateTime(date);
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

  private createRunExpiresAt() {
    return new Date(Date.now() + this.runExpirationMinutes * 60 * 1000);
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

  private parseJsonObject(value: unknown) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }

    if (typeof value !== 'string' || !value.trim()) {
      return {};
    }

    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
