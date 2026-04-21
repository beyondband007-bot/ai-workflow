import type { CliArgs } from "../types.js";

const DEFAULT_MODEL = "nano-banana-2";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 15 * 60 * 1000;

type CreateTaskResponse = {
  code: number;
  msg?: string;
  data?: {
    taskId?: string;
  };
};

type TaskInfoResponse = {
  code: number;
  msg?: string;
  data?: {
    state?: "waiting" | "queuing" | "generating" | "success" | "fail" | string;
    resultJson?: string;
    failMsg?: string;
    failCode?: string;
  };
};

type ResultJson = {
  resultUrls?: string[];
  resultUrl?: string;
  url?: string;
};

export function getDefaultModel(): string {
  return process.env.KIE_IMAGE_MODEL || DEFAULT_MODEL;
}

function getApiKey(): string {
  const apiKey = process.env.KIE_API_KEY;
  if (!apiKey) throw new Error("KIE_API_KEY is required");
  return apiKey;
}

function getBaseUrl(): string {
  return (process.env.KIE_BASE_URL || "https://api.kie.ai").replace(/\/+$/g, "");
}

function mapAspectRatio(ar: string | null): string {
  return ar || "auto";
}

function mapResolution(args: CliArgs): "1K" | "2K" | "4K" {
  if (args.imageSize === "1K" || args.imageSize === "2K" || args.imageSize === "4K") {
    return args.imageSize;
  }
  return args.quality === "normal" ? "1K" : "2K";
}

function stringifyForKie(payload: unknown): string {
  return JSON.stringify(payload).replace(/[\u007f-\uffff]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

async function createTask(apiKey: string, model: string, prompt: string, args: CliArgs): Promise<string> {
  if (args.referenceImages.length > 0) {
    throw new Error("Reference images are not supported with KIE Nano Banana 2 in this app yet.");
  }

  const res = await fetch(`${getBaseUrl()}/api/v1/jobs/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: stringifyForKie({
      model,
      input: {
        prompt,
        image_input: [],
        aspect_ratio: mapAspectRatio(args.aspectRatio),
        resolution: mapResolution(args),
        output_format: "png",
      },
    }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`KIE API error (${res.status}): ${text}`);

  const parsed = JSON.parse(text) as CreateTaskResponse;
  if (parsed.code !== 200 || !parsed.data?.taskId) {
    throw new Error(`KIE task creation failed: ${parsed.msg || text}`);
  }
  return parsed.data.taskId;
}

function extractResultUrl(resultJson: string | undefined): string {
  if (!resultJson) throw new Error("KIE task succeeded without resultJson");
  const parsed = JSON.parse(resultJson) as ResultJson;
  const url = parsed.resultUrls?.[0] || parsed.resultUrl || parsed.url;
  if (!url) throw new Error(`KIE resultJson did not contain an image URL: ${resultJson}`);
  return url;
}

async function pollTask(apiKey: string, taskId: string): Promise<string> {
  const deadline = Date.now() + MAX_POLL_MS;

  while (Date.now() < deadline) {
    const url = new URL(`${getBaseUrl()}/api/v1/jobs/recordInfo`);
    url.searchParams.set("taskId", taskId);

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`KIE poll error (${res.status}): ${text}`);

    const parsed = JSON.parse(text) as TaskInfoResponse;
    if (parsed.code !== 200) throw new Error(`KIE poll failed: ${parsed.msg || text}`);

    const state = parsed.data?.state;
    if (state === "success") return extractResultUrl(parsed.data?.resultJson);
    if (state === "fail") {
      throw new Error(`KIE task failed: ${parsed.data?.failMsg || parsed.data?.failCode || "unknown error"}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`KIE task timed out after ${Math.round(MAX_POLL_MS / 1000)} seconds`);
}

async function downloadImage(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`KIE result download error (${res.status}): ${err}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function generateImage(prompt: string, model: string, args: CliArgs): Promise<Uint8Array> {
  const apiKey = getApiKey();
  const taskId = await createTask(apiKey, model || DEFAULT_MODEL, prompt, args);
  const resultUrl = await pollTask(apiKey, taskId);
  return downloadImage(resultUrl);
}
