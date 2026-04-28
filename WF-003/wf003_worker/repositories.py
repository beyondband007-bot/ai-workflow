from __future__ import annotations

import json
from typing import Any

import pymysql
from pymysql.cursors import DictCursor

from .config import Settings
from .models import NormalizedSubmission, ParsedKieCallback, TaskItem


class TaskRepository:
    def __init__(self, settings: Settings):
        self.settings = settings

    def create_submission(self, submission: NormalizedSubmission) -> None:
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
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
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 0, 0, NULL)
                    ON DUPLICATE KEY UPDATE
                      run_id = VALUES(run_id),
                      workflow_code = VALUES(workflow_code),
                      client_request_id = VALUES(client_request_id),
                      user_id = VALUES(user_id),
                      callback_url = VALUES(callback_url),
                      callback_token = VALUES(callback_token),
                      car_name = VALUES(car_name),
                      logo = VALUES(logo),
                      feishu_app_id = VALUES(feishu_app_id),
                      feishu_id = VALUES(feishu_id),
                      expected_tasks = VALUES(expected_tasks),
                      finalized = 0,
                      finalize_in_progress = 0,
                      finalize_token = NULL,
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    (
                        submission.submission_id,
                        submission.run_id,
                        submission.workflow_code,
                        submission.client_request_id,
                        submission.user_id,
                        submission.callback_url,
                        submission.callback_token,
                        submission.car_name,
                        submission.logo,
                        submission.feishu_app_id,
                        submission.feishu_id,
                        submission.expected_tasks,
                    ),
                )
            conn.commit()

    def register_task(self, task: TaskItem, task_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
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
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'submitted', NULL)
                    ON DUPLICATE KEY UPDATE
                      submission_id = VALUES(submission_id),
                      type = VALUES(type),
                      task_index = VALUES(task_index),
                      group_index = VALUES(group_index),
                      image_url = VALUES(image_url),
                      image_urls_json = VALUES(image_urls_json),
                      state = 'submitted',
                      result_url = NULL,
                      updated_at = CURRENT_TIMESTAMP
                    """,
                    (
                        task_id,
                        task.submission_id,
                        task.type,
                        task.index,
                        task.group_index,
                        task.image_url,
                        json.dumps(task.image_urls, ensure_ascii=False),
                    ),
                )
            conn.commit()
        return {
            "ok": True,
            "submissionId": task.submission_id,
            "taskId": task_id,
            "type": task.type,
            "index": task.index,
            "groupIndex": task.group_index,
        }

    def update_callback(self, callback: ParsedKieCallback) -> dict[str, Any]:
        with self._connect() as conn:
            try:
                with conn.cursor() as cursor:
                    cursor.execute("START TRANSACTION")
                    cursor.execute(
                        """
                        SELECT task_id, submission_id, type, state, result_url
                        FROM wf003_tasks
                        WHERE task_id = %s
                        LIMIT 1
                        """,
                        (callback.task_id,),
                    )
                    task = cursor.fetchone()
                    if not task:
                        conn.commit()
                        return {
                            "ok": False,
                            "accepted": True,
                            "reason": "task_not_found",
                            "taskId": callback.task_id,
                            "isComplete": False,
                            "shouldFinalize": False,
                        }

                    submission_id = str(task["submission_id"])
                    cursor.execute(
                        """
                        SELECT submission_id, expected_tasks, finalized, finalize_in_progress
                        FROM wf003_submissions
                        WHERE submission_id = %s
                        LIMIT 1
                        FOR UPDATE
                        """,
                        (submission_id,),
                    )
                    submission = cursor.fetchone()
                    if not submission:
                        conn.commit()
                        return {
                            "ok": False,
                            "accepted": True,
                            "reason": "submission_not_found",
                            "submissionId": submission_id,
                            "taskId": callback.task_id,
                            "isComplete": False,
                            "shouldFinalize": False,
                        }

                    expected_tasks = int(submission["expected_tasks"] or 0)
                    if int(submission["finalized"] or 0) == 1:
                        counts = self._get_counts(cursor, submission_id)
                        conn.commit()
                        return {
                            "ok": True,
                            "accepted": True,
                            "submissionId": submission_id,
                            "taskId": callback.task_id,
                            "taskType": task["type"],
                            "state": task.get("state") or callback.state,
                            "resultUrl": task.get("result_url") or callback.result_url,
                            "expectedTasks": expected_tasks,
                            **counts,
                            "isComplete": False,
                            "shouldFinalize": False,
                            "reason": "already_finalized",
                        }

                    existing_state = str(task.get("state") or "")
                    existing_result_url = str(task.get("result_url") or "")
                    if existing_state in {"success", "failed", "error"} or existing_result_url:
                        counts = self._get_counts(cursor, submission_id)
                        is_complete = counts["resolvedCount"] >= expected_tasks
                        should_finalize = (
                            is_complete
                            and int(submission["finalized"] or 0) == 0
                            and int(submission["finalize_in_progress"] or 0) == 0
                        )
                        if should_finalize:
                            cursor.execute(
                                """
                                UPDATE wf003_submissions
                                SET finalize_in_progress = 1,
                                    finalize_requested_at = CURRENT_TIMESTAMP,
                                    updated_at = CURRENT_TIMESTAMP
                                WHERE submission_id = %s
                                """,
                                (submission_id,),
                            )
                        conn.commit()
                        return {
                            "ok": True,
                            "accepted": True,
                            "submissionId": submission_id,
                            "taskId": callback.task_id,
                            "taskType": task["type"],
                            "state": existing_state,
                            "resultUrl": existing_result_url or None,
                            "expectedTasks": expected_tasks,
                            **counts,
                            "isComplete": is_complete,
                            "shouldFinalize": should_finalize,
                            "reason": "duplicate_callback",
                        }

                    cursor.execute(
                        """
                        UPDATE wf003_tasks
                        SET state = %s,
                            raw_state = %s,
                            result_url = %s,
                            fail_code = %s,
                            fail_msg = %s,
                            callback_payload_json = %s,
                            last_callback_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE task_id = %s
                        """,
                        (
                            callback.state,
                            callback.raw_state or None,
                            callback.result_url,
                            callback.fail_code,
                            callback.fail_msg,
                            json.dumps(callback.body, ensure_ascii=False),
                            callback.task_id,
                        ),
                    )
                    counts = self._get_counts(cursor, submission_id)
                    is_complete = counts["resolvedCount"] >= expected_tasks
                    should_finalize = False
                    if (
                        is_complete
                        and int(submission["finalized"] or 0) == 0
                        and int(submission["finalize_in_progress"] or 0) == 0
                    ):
                        should_finalize = True
                        cursor.execute(
                            """
                            UPDATE wf003_submissions
                            SET finalize_in_progress = 1,
                                finalize_requested_at = CURRENT_TIMESTAMP,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE submission_id = %s
                            """,
                            (submission_id,),
                        )
                    else:
                        cursor.execute(
                            """
                            UPDATE wf003_submissions
                            SET updated_at = CURRENT_TIMESTAMP
                            WHERE submission_id = %s
                            """,
                            (submission_id,),
                        )

                conn.commit()
                return {
                    "ok": True,
                    "accepted": True,
                    "submissionId": submission_id,
                    "taskId": callback.task_id,
                    "taskType": task["type"],
                    "state": callback.state,
                    "resultUrl": callback.result_url,
                    "failCode": callback.fail_code,
                    "failMsg": callback.fail_msg,
                    "expectedTasks": expected_tasks,
                    **counts,
                    "isComplete": is_complete,
                    "shouldFinalize": should_finalize,
                }
            except Exception:
                conn.rollback()
                raise

    def build_final_assets(self, submission_id: str) -> dict[str, Any]:
        with self._connect() as conn:
            try:
                with conn.cursor() as cursor:
                    cursor.execute("START TRANSACTION")
                    cursor.execute(
                        """
                        SELECT submission_id, run_id, workflow_code, client_request_id,
                               callback_url, callback_token, car_name, feishu_app_id,
                               feishu_id, finalized
                        FROM wf003_submissions
                        WHERE submission_id = %s
                        LIMIT 1
                        FOR UPDATE
                        """,
                        (submission_id,),
                    )
                    submission = cursor.fetchone()
                    if not submission:
                        conn.commit()
                        return {"skipFinalize": True, "reason": "submission_not_found", "submissionId": submission_id}
                    if int(submission["finalized"] or 0) == 1:
                        conn.commit()
                        return {"skipFinalize": True, "reason": "already_finalized", "submissionId": submission_id}

                    cursor.execute(
                        """
                        SELECT task_id, type, task_index, group_index, state,
                               result_url, fail_code, fail_msg
                        FROM wf003_tasks
                        WHERE submission_id = %s
                        """,
                        (submission_id,),
                    )
                    tasks = cursor.fetchall()
                conn.commit()
            except Exception:
                conn.rollback()
                raise

        exterior_images = [
            {
                "originalIndex": int(task["task_index"] or 0) or None,
                "imageUrl": task["result_url"],
                "fileName": f"exterior_{index}.jpg",
                "taskId": task["task_id"],
            }
            for index, task in enumerate(
                sorted(
                    [
                        task
                        for task in tasks
                        if task["type"] == "exterior" and task["state"] == "success" and task["result_url"]
                    ],
                    key=lambda item: int(item["task_index"] or 0),
                ),
                start=1,
            )
        ]
        interior_images = [
            {
                "groupIndex": int(task["group_index"] or 0) or None,
                "imageUrl": task["result_url"],
                "fileName": f"interior_{index}.jpg",
                "taskId": task["task_id"],
            }
            for index, task in enumerate(
                sorted(
                    [
                        task
                        for task in tasks
                        if task["type"] == "interior" and task["state"] == "success" and task["result_url"]
                    ],
                    key=lambda item: int(item["group_index"] or 0),
                ),
                start=1,
            )
        ]
        failed_tasks = [
            {
                "type": task["type"],
                "index": int(task["task_index"] or task["group_index"] or 0) or None,
                "taskId": task["task_id"],
                "failCode": task["fail_code"],
                "failMsg": task["fail_msg"],
            }
            for task in tasks
            if task["state"] in {"failed", "error"}
        ]

        return {
            "skipFinalize": False,
            "submissionId": submission_id,
            "run_id": submission["run_id"] or submission_id,
            "workflow_code": submission["workflow_code"] or "WF-003",
            "client_request_id": submission["client_request_id"] or "",
            "callback_url": submission["callback_url"] or "",
            "callback_token": submission["callback_token"] or "",
            "car_name": submission["car_name"] or "",
            "feishu_app_id": submission["feishu_app_id"] or "",
            "feishu_id": submission["feishu_id"] or "",
            "exteriorImages": exterior_images,
            "interiorImages": interior_images,
            "totalExterior": len(exterior_images),
            "totalInterior": len(interior_images),
            "successCount": len(exterior_images) + len(interior_images),
            "failedCount": len(failed_tasks),
            "failedTasks": failed_tasks,
        }

    def mark_finalized(self, submission_id: str) -> None:
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE wf003_submissions
                    SET finalized = 1,
                        finalized_at = COALESCE(finalized_at, CURRENT_TIMESTAMP),
                        finalize_in_progress = 0,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE submission_id = %s
                    """,
                    (submission_id,),
                )
            conn.commit()

    def mark_finalize_failed(self, submission_id: str, error_message: str) -> None:
        with self._connect() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE wf003_submissions
                    SET finalize_in_progress = 0,
                        finalize_error = %s,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE submission_id = %s
                    """,
                    (error_message[:1000], submission_id),
                )
            conn.commit()

    def _get_counts(self, cursor: DictCursor, submission_id: str) -> dict[str, int]:
        cursor.execute(
            """
            SELECT
              SUM(CASE WHEN state IN ('success', 'failed', 'error')
                         OR (result_url IS NOT NULL AND result_url <> '')
                       THEN 1 ELSE 0 END) AS resolved_count,
              SUM(CASE WHEN state = 'success'
                         AND (result_url IS NOT NULL AND result_url <> '')
                       THEN 1 ELSE 0 END) AS success_count,
              SUM(CASE WHEN state IN ('failed', 'error') THEN 1 ELSE 0 END) AS failed_count
            FROM wf003_tasks
            WHERE submission_id = %s
            """,
            (submission_id,),
        )
        counts = cursor.fetchone() or {}
        return {
            "resolvedCount": int(counts.get("resolved_count") or 0),
            "successCount": int(counts.get("success_count") or 0),
            "failedCount": int(counts.get("failed_count") or 0),
        }

    def _connect(self):
        return pymysql.connect(
            host=self.settings.database_host,
            port=self.settings.database_port,
            user=self.settings.database_username,
            password=self.settings.database_password,
            database=self.settings.database_name,
            charset="utf8mb4",
            cursorclass=DictCursor,
            autocommit=False,
        )
