SET @workflow_runs_expires_at_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'workflow_runs'
      AND COLUMN_NAME = 'expires_at'
);

SET @add_workflow_runs_expires_at = IF(
    @workflow_runs_expires_at_exists = 0,
    'ALTER TABLE workflow_runs ADD COLUMN expires_at DATETIME NULL AFTER started_at',
    'SELECT 1'
);
PREPARE add_workflow_runs_expires_at_stmt FROM @add_workflow_runs_expires_at;
EXECUTE add_workflow_runs_expires_at_stmt;
DEALLOCATE PREPARE add_workflow_runs_expires_at_stmt;

SET @workflow_runs_expires_at_index_exists = (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'workflow_runs'
      AND INDEX_NAME = 'idx_workflow_runs_expires_at'
);

SET @add_workflow_runs_expires_at_index = IF(
    @workflow_runs_expires_at_index_exists = 0,
    'ALTER TABLE workflow_runs ADD INDEX idx_workflow_runs_expires_at (expires_at)',
    'SELECT 1'
);
PREPARE add_workflow_runs_expires_at_index_stmt FROM @add_workflow_runs_expires_at_index;
EXECUTE add_workflow_runs_expires_at_index_stmt;
DEALLOCATE PREPARE add_workflow_runs_expires_at_index_stmt;

UPDATE workflow_runs
SET expires_at = DATE_ADD(started_at, INTERVAL 30 MINUTE)
WHERE expires_at IS NULL;
