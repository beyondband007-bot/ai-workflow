import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { aspectRatios, providers, qualities, type Provider, type Quality } from "@baoyu-image-gen/core";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import "dotenv/config";
import Fastify, { type FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import { enqueueGeneration, getExecutorStatus } from "./executor.js";
import { imageDir, uploadDir } from "./paths.js";

const app = Fastify({
  logger: true,
});

const defaultModels: Record<Provider, string> = {
  google: process.env.GOOGLE_IMAGE_MODEL || "gemini-3-pro-image-preview",
  openai: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5",
  dashscope: process.env.DASHSCOPE_IMAGE_MODEL || "z-image-turbo",
  replicate: process.env.REPLICATE_IMAGE_MODEL || "google/nano-banana-pro",
  kie: process.env.KIE_IMAGE_MODEL || "nano-banana-2",
};

const allowedMimeTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

type GenerationFields = {
  prompt: string;
  provider: Provider;
  model: string | null;
  aspectRatio: string | null;
  quality: Quality | null;
  imageSize: string | null;
  size: string | null;
  projectData: Prisma.InputJsonValue | null;
};

type SavedUpload = {
  filePath: string;
  mimeType: string;
  sizeBytes: number;
};

type CreateGenerationBody = Partial<Record<keyof GenerationFields, string | null>>;

function assertProvider(value: string | null | undefined): Provider {
  if (value && providers.includes(value as Provider)) return value as Provider;
  return "google";
}

function assertQuality(value: string | null | undefined): Quality | null {
  if (!value) return null;
  if (qualities.includes(value as Quality)) return value as Quality;
  throw httpError(400, `Invalid quality: ${value}`);
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeProjectData(value: unknown): Prisma.InputJsonValue | null {
  const raw = normalizeOptional(value);
  if (!raw) return null;
  if (raw.length > 20000) throw httpError(400, "projectData is too large");

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw httpError(400, "projectData must be a JSON object");
    }
    return parsed as Prisma.InputJsonValue;
  } catch (caught) {
    if (caught instanceof Error && "statusCode" in caught) throw caught;
    throw httpError(400, "projectData must be valid JSON");
  }
}

function normalizeFields(input: CreateGenerationBody): GenerationFields {
  const prompt = normalizeOptional(input.prompt);
  if (!prompt) throw httpError(400, "prompt is required");

  const provider = assertProvider(normalizeOptional(input.provider));
  const quality = assertQuality(normalizeOptional(input.quality));

  return {
    prompt,
    provider,
    model: normalizeOptional(input.model),
    aspectRatio: normalizeOptional(input.aspectRatio),
    quality,
    imageSize: normalizeOptional(input.imageSize),
    size: normalizeOptional(input.size),
    projectData: normalizeProjectData(input.projectData),
  };
}

function formatJob(job: {
  id: string;
  status: string;
  prompt: string;
  provider: string;
  model: string | null;
  aspectRatio: string | null;
  quality: string | null;
  imageSize: string | null;
  size: string | null;
  projectData: unknown;
  outputPath: string | null;
  outputUrl: string | null;
  attempts: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  assets?: Array<{
    id: string;
    kind: string;
    filePath: string;
    mimeType: string;
    sizeBytes: bigint;
    createdAt: Date;
  }>;
}) {
  return {
    ...job,
    assets: job.assets?.map((asset) => ({
      ...asset,
      sizeBytes: asset.sizeBytes.toString(),
    })),
  };
}

async function parseJsonBody(body: unknown): Promise<{ fields: GenerationFields; uploads: SavedUpload[] }> {
  return {
    fields: normalizeFields((body ?? {}) as CreateGenerationBody),
    uploads: [],
  };
}

async function parseMultipartRequest(
  request: FastifyRequest,
  jobId: string,
): Promise<{ fields: GenerationFields; uploads: SavedUpload[] }> {
  const rawFields: CreateGenerationBody = {};
  const uploads: SavedUpload[] = [];
  let uploadIndex = 0;

  for await (const part of request.parts()) {
    if (part.type === "field") {
      rawFields[part.fieldname as keyof GenerationFields] = String(part.value ?? "");
      continue;
    }

    if (part.fieldname !== "referenceImages") {
      await part.toBuffer();
      continue;
    }

    const ext = allowedMimeTypes.get(part.mimetype);
    if (!ext) {
      throw httpError(400, `Unsupported reference image type: ${part.mimetype}`);
    }

    const buffer = await part.toBuffer();
    uploadIndex += 1;
    const filename = `${jobId}-${uploadIndex}${ext}`;
    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);
    uploads.push({
      filePath,
      mimeType: part.mimetype,
      sizeBytes: buffer.length,
    });
  }

  return {
    fields: normalizeFields(rawFields),
    uploads,
  };
}

await app.register(cors, {
  origin: true,
});

await app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 4,
  },
});

await mkdir(uploadDir, { recursive: true });
await mkdir(imageDir, { recursive: true });

await app.register(fastifyStatic, {
  root: imageDir,
  prefix: "/api/images/",
  decorateReply: false,
});

app.get("/api/health", async () => {
  return {
    ok: true,
    service: "baoyu-image-gen-api",
    database: {
      configured: Boolean(process.env.DATABASE_URL),
    },
    executor: getExecutorStatus(),
  };
});

app.get("/api/config", async () => {
  return {
    providers,
    aspectRatios,
    qualities,
    defaultProvider: "google",
    defaultModels,
    upload: {
      acceptedMimeTypes: [...allowedMimeTypes.keys()],
      maxFiles: 4,
      maxFileSizeBytes: 10 * 1024 * 1024,
    },
  };
});

app.post("/api/generations", async (request, reply) => {
  const jobId = randomUUID();
  const parsed = request.isMultipart()
    ? await parseMultipartRequest(request, jobId)
    : await parseJsonBody(request.body);

  const job = await prisma.generationJob.create({
    data: {
      id: jobId,
      status: "queued",
      prompt: parsed.fields.prompt,
      provider: parsed.fields.provider,
      model: parsed.fields.model,
      aspectRatio: parsed.fields.aspectRatio,
      quality: parsed.fields.quality,
      imageSize: parsed.fields.imageSize,
      size: parsed.fields.size,
      projectData: parsed.fields.projectData ?? undefined,
      assets: {
        create: parsed.uploads.map((upload) => ({
          id: randomUUID(),
          kind: "reference",
          filePath: upload.filePath,
          mimeType: upload.mimeType,
          sizeBytes: BigInt(upload.sizeBytes),
        })),
      },
    },
    include: {
      assets: true,
    },
  });

  reply.code(201);
  enqueueGeneration(job.id);
  return {
    jobId: job.id,
    job: formatJob(job),
  };
});

app.get<{ Params: { jobId: string } }>("/api/generations/:jobId", async (request, reply) => {
  const job = await prisma.generationJob.findUnique({
    where: {
      id: request.params.jobId,
    },
    include: {
      assets: true,
    },
  });

  if (!job) throw httpError(404, "generation job not found");
  reply.code(200);
  return formatJob(job);
});

app.delete<{ Params: { jobId: string } }>("/api/generations/:jobId", async (request) => {
  const job = await prisma.generationJob.findUnique({
    where: {
      id: request.params.jobId,
    },
    include: {
      assets: true,
    },
  });

  if (!job) throw httpError(404, "generation job not found");

  await prisma.generationJob.delete({
    where: {
      id: job.id,
    },
  });

  const pathsToDelete = new Set<string>();
  if (job.outputPath) pathsToDelete.add(job.outputPath);
  for (const asset of job.assets) pathsToDelete.add(asset.filePath);

  await Promise.all(
    [...pathsToDelete].map((filePath) => rm(filePath, { force: true }).catch(() => undefined)),
  );

  return {
    ok: true,
    deletedJobId: job.id,
  };
});

app.get<{ Querystring: { limit?: string } }>("/api/generations", async (request) => {
  const parsedLimit = Number(request.query.limit ?? 20);
  const take = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 100)) : 20;
  const jobs = await prisma.generationJob.findMany({
    take,
    orderBy: {
      createdAt: "desc",
    },
    include: {
      assets: true,
    },
  });

  return {
    jobs: jobs.map(formatJob),
  };
});

const host = process.env.API_HOST || "127.0.0.1";
const port = Number(process.env.API_PORT || 3001);

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
