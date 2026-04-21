-- CreateTable
CREATE TABLE `generation_jobs` (
    `id` VARCHAR(36) NOT NULL,
    `status` ENUM('queued', 'running', 'succeeded', 'failed') NOT NULL DEFAULT 'queued',
    `prompt` TEXT NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `model` VARCHAR(255) NULL,
    `aspect_ratio` VARCHAR(32) NULL,
    `quality` VARCHAR(32) NULL,
    `image_size` VARCHAR(32) NULL,
    `size` VARCHAR(32) NULL,
    `output_path` VARCHAR(1024) NULL,
    `output_url` VARCHAR(1024) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,

    INDEX `generation_jobs_status_created_at_idx`(`status`, `created_at`),
    INDEX `generation_jobs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `generation_assets` (
    `id` VARCHAR(36) NOT NULL,
    `job_id` VARCHAR(36) NOT NULL,
    `kind` ENUM('reference', 'output') NOT NULL,
    `file_path` VARCHAR(1024) NOT NULL,
    `mime_type` VARCHAR(255) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `generation_assets_job_id_kind_idx`(`job_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `generation_assets` ADD CONSTRAINT `generation_assets_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
