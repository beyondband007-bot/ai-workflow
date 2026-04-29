const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const axios = require("axios");
const Busboy = require("busboy");
const FormData = require("form-data");

const host = "0.0.0.0";
const port = process.env.PORT ? Number(process.env.PORT) : 3001;
const rootDir = __dirname;
const workflowSubmitPath = process.env.WORKFLOW_SUBMIT_PATH || "/webhook/wf003-kie-submit";
const legacyMiddlePlatformUrl = (process.env.WF_003_MIDDLE_PLATFORM_URL || "").replace(/\/$/, "");
const workflowWebhookUrl = (process.env.WF_003_WEBHOOK_URL || "").replace(/\/$/, "");
const inferredWorkflowApiBase = legacyMiddlePlatformUrl
  ? new URL(legacyMiddlePlatformUrl).origin
  : "";
const workflowApiBase = (process.env.WORKFLOW_API_BASE || inferredWorkflowApiBase).replace(/\/$/, "");
const kieUploadUrl =
  process.env.KIE_UPLOAD_URL || "https://kieai.riftrunnerai.com/api/file-stream-upload";
const kieApiKey = process.env.KIE_API_KEY || "";
const kieUploadMaxAttempts = process.env.KIE_UPLOAD_MAX_ATTEMPTS
  ? Number(process.env.KIE_UPLOAD_MAX_ATTEMPTS)
  : 3;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendRuntimeConfig(res) {
  const payload = {
    kieUploadUrl: process.env.PUBLIC_KIE_UPLOAD_URL || "/api/kie-upload",
    kieApiKey: process.env.PUBLIC_KIE_API_KEY || "",
    workflowApiBase: process.env.PUBLIC_WORKFLOW_API_BASE || "",
    workflowWebhookUrl,
  };
  const body = `window.__WF003_CONFIG__ = ${JSON.stringify(payload)};\n`;
  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readMultipartUpload(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      reject(new Error("multipart/form-data is required"));
      return;
    }

    const busboy = Busboy({ headers: req.headers });
    const fields = {};
    let uploadedFile = null;

    busboy.on("field", (name, value) => {
      fields[name] = value;
    });

    busboy.on("file", (name, file, info) => {
      const chunks = [];
      file.on("data", (chunk) => chunks.push(chunk));
      file.on("end", () => {
        uploadedFile = {
          fieldName: name,
          filename: info.filename || fields.fileName || "wf003-upload.jpg",
          mimeType: info.mimeType || "application/octet-stream",
          buffer: Buffer.concat(chunks),
        };
      });
      file.on("error", reject);
    });

    busboy.on("finish", () => {
      if (!uploadedFile || !uploadedFile.buffer.length) {
        reject(new Error("file is required"));
        return;
      }
      resolve({ fields, uploadedFile });
    });

    busboy.on("error", reject);
    req.pipe(busboy);
  });
}

function extensionFromMimeType(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".jpg";
}

function buildSafeKieFileName(originalName, mimeType) {
  const ext = path.extname(originalName || "").toLowerCase() || extensionFromMimeType(mimeType);
  return `wf003_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function proxyKieUpload(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  if (!kieApiKey) {
    sendJson(res, 500, {
      error: "kie_api_key_missing",
      message: "KIE_API_KEY is not configured on car-export-portal server",
    });
    return;
  }

  try {
    const { fields, uploadedFile } = await readMultipartUpload(req);
    const safeFileName = buildSafeKieFileName(uploadedFile.filename, uploadedFile.mimeType);
    let upstream = null;
    let lastError = null;

    for (let attempt = 1; attempt <= kieUploadMaxAttempts; attempt += 1) {
      const form = new FormData();
      form.append("file", uploadedFile.buffer, {
        filename: safeFileName,
        contentType: uploadedFile.mimeType,
        knownLength: uploadedFile.buffer.length,
      });
      form.append("uploadPath", fields.uploadPath || "wf003");
      form.append("fileName", safeFileName);

      try {
        upstream = await axios.post(kieUploadUrl, form, {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${kieApiKey}`,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          responseType: "arraybuffer",
          timeout: 120000,
          validateStatus: () => true,
        });
        break;
      } catch (error) {
        lastError = error;
        console.warn(
          `Kie upload attempt ${attempt}/${kieUploadMaxAttempts} failed: ${error.message}`,
        );
        if (attempt < kieUploadMaxAttempts) {
          await sleep(1000 * attempt);
        }
      }
    }

    if (!upstream) {
      throw lastError || new Error("Kie upload failed before receiving a response");
    }

    const responseHeaders = { ...upstream.headers };
    delete responseHeaders["transfer-encoding"];
    responseHeaders["content-length"] = String(upstream.data.length);
    responseHeaders["cache-control"] = responseHeaders["cache-control"] || "no-store";

    res.writeHead(upstream.status, responseHeaders);
    res.end(Buffer.from(upstream.data));
  } catch (error) {
    sendJson(res, 502, {
      error: "kie_upload_proxy_failed",
      message: error.message,
    });
  }
}

function resolveWorkflowSubmitUpstream() {
  if (workflowWebhookUrl) {
    return {
      source: "WF_003_WEBHOOK_URL",
      url: workflowWebhookUrl,
    };
  }

  if (legacyMiddlePlatformUrl) {
    return {
      source: "WF_003_MIDDLE_PLATFORM_URL",
      url: legacyMiddlePlatformUrl,
    };
  }

  if (workflowApiBase) {
    return {
      source: "WORKFLOW_API_BASE",
      url: `${workflowApiBase}${workflowSubmitPath}`,
    };
  }

  return null;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

async function proxyApiRequest(req, res, requestUrl) {
  let upstreamUrl = "";

  if (requestUrl.pathname === "/api/v1/workflows/WF-003/json-execute") {
    const upstream = resolveWorkflowSubmitUpstream();

    if (!upstream) {
      sendJson(res, 502, {
        error: "workflow_api_base_missing",
        message:
          "None of WF_003_WEBHOOK_URL, WF_003_MIDDLE_PLATFORM_URL, or WORKFLOW_API_BASE is configured",
      });
      return;
    }

    upstreamUrl = upstream.url;
  } else {
    if (!workflowApiBase) {
      sendJson(res, 502, {
        error: "workflow_api_base_missing",
        message: "WORKFLOW_API_BASE is not configured",
      });
      return;
    }
    upstreamUrl = `${workflowApiBase}${requestUrl.pathname}${requestUrl.search}`;
  }

  const body = await readRequestBody(req);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];

  try {
    const upstream = await axios({
      url: upstreamUrl,
      method: req.method,
      headers,
      data: body.length ? body : undefined,
      responseType: "arraybuffer",
      validateStatus: () => true,
    });

    const responseHeaders = { ...upstream.headers };
    delete responseHeaders["transfer-encoding"];
    responseHeaders["content-length"] = String(upstream.data.length);
    responseHeaders["cache-control"] = responseHeaders["cache-control"] || "no-store";

    res.writeHead(upstream.status, responseHeaders);
    res.end(Buffer.from(upstream.data));
  } catch (error) {
    sendJson(res, 502, {
      error: "workflow_api_proxy_failed",
      message: error.message,
      upstreamUrl,
    });
  }
}

function serveStatic(res, pathname) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(rootDir, normalizedPath);

  if (!filePath.startsWith(rootDir)) {
    sendJson(res, 403, { error: "forbidden" });
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: "not found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/api/kie-upload") {
    proxyKieUpload(req, res).catch((error) => {
      sendJson(res, 500, {
        error: "kie_upload_proxy_unexpected_error",
        message: error.message,
      });
    });
    return;
  }

  if (requestUrl.pathname.startsWith("/api/")) {
    proxyApiRequest(req, res, requestUrl).catch((error) => {
      sendJson(res, 500, {
        error: "workflow_api_proxy_unexpected_error",
        message: error.message,
      });
    });
    return;
  }

  if (req.method === "GET") {
    if (requestUrl.pathname === "/runtime-config.js") {
      sendRuntimeConfig(res);
      return;
    }

    serveStatic(res, requestUrl.pathname);
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(port, host, () => {
  const submitUpstream = resolveWorkflowSubmitUpstream();
  console.log(`car-export-portal running at http://localhost:${port}`);
  console.log(
    `WF-003 submit upstream: ${
      submitUpstream ? `${submitUpstream.source} -> ${submitUpstream.url}` : "not configured"
    }`,
  );
});
