import path from "node:path";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { generateImageTask, type GenerationInput, type Provider, type Quality } from "@baoyu-image-gen/core";
import { prisma } from "./db.js";
import { imageDir } from "./paths.js";

type JobForExecution = {
  id: string;
  prompt: string;
  provider: string;
  model: string | null;
  aspectRatio: string | null;
  quality: string | null;
  imageSize: string | null;
  size: string | null;
  assets: Array<{
    kind: string;
    filePath: string;
  }>;
};

const maxConcurrentJobs = Math.max(
  1,
  Number.parseInt(process.env.GENERATION_CONCURRENCY || "1", 10) || 1,
);

const queue: string[] = [];
let activeJobs = 0;

function toImageUrl(filename: string): string {
  return `/api/images/${encodeURIComponent(filename)}`;
}

function toGenerationInput(job: JobForExecution, outputPath: string): GenerationInput {
  return {
    prompt: job.prompt,
    outputPath,
    provider: job.provider as Provider,
    model: job.model,
    aspectRatio: job.aspectRatio,
    quality: job.quality as Quality | null,
    imageSize: job.imageSize,
    size: job.size,
    referenceImages: job.assets
      .filter((asset) => asset.kind === "reference")
      .map((asset) => asset.filePath),
  };
}

async function executeJob(jobId: string): Promise<void> {
  const job = await prisma.generationJob.findUnique({
    where: { id: jobId },
    include: { assets: true },
  });

  if (!job || job.status !== "queued") return;

  const outputFilename = `${job.id}.png`;
  const outputPath = path.join(imageDir, outputFilename);

  await prisma.generationJob.update({
    where: { id: job.id },
    data: {
      status: "running",
      startedAt: new Date(),
      error: null,
    },
  });

  try {
    const result = await generateImageTask(toGenerationInput(job, outputPath));
    if (!result.success) {
      await prisma.generationJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          attempts: result.attempts,
          error: result.error || "Generation failed",
          finishedAt: new Date(),
        },
      });
      return;
    }
    const outputStat = await stat(result.outputPath);

    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: "succeeded",
        outputPath: result.outputPath,
        outputUrl: toImageUrl(outputFilename),
        provider: result.provider,
        model: result.model,
        attempts: result.attempts,
        finishedAt: new Date(),
        assets: {
          create: {
            id: randomUUID(),
            kind: "output",
            filePath: result.outputPath,
            mimeType: "image/png",
            sizeBytes: BigInt(outputStat.size),
          },
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.generationJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        error: message,
        finishedAt: new Date(),
      },
    });
  }
}

function pumpQueue(): void {
  while (activeJobs < maxConcurrentJobs && queue.length > 0) {
    const jobId = queue.shift();
    if (!jobId) return;

    activeJobs += 1;
    void executeJob(jobId).finally(() => {
      activeJobs -= 1;
      pumpQueue();
    });
  }
}

export function enqueueGeneration(jobId: string): void {
  queue.push(jobId);
  pumpQueue();
}

export function getExecutorStatus() {
  return {
    activeJobs,
    queuedJobs: queue.length,
    maxConcurrentJobs,
  };
}
