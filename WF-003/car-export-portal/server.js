const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const axios = require("axios");
const Busboy = require("busboy");
const FormData = require("form-data");

const host = "0.0.0.0";
const port = process.env.PORT ? Number(process.env.PORT) : 3001;
const rootDir = __dirname;
const workflowApiBase = (process.env.WORKFLOW_API_BASE || "").replace(/\/$/, "");
const middlePlatformBase = (process.env.MIDDLE_PLATFORM_BASE || "").replace(/\/$/, "");
const workflowSubmitPath = process.env.WORKFLOW_SUBMIT_PATH || "/webhook/wf003-kie-submit-123";
const legacyMiddlePlatformUrl = (process.env.WF_003_MIDDLE_PLATFORM_URL || "").replace(/\/$/, "");
const workflowWebhookUrl = (process.env.WF_003_WEBHOOK_URL || "").replace(/\/$/, "");
const callbackBaseUrl = (process.env.WF_003_CALLBACK_BASE_URL || "").replace(/\/$/, "");
const callbackToken = (process.env.WF_003_CALLBACK_TOKEN || "").trim();
const defaultFeishuAppId = (process.env.WF_003_FEISHU_APP_ID || process.env.FEISHU_APP_ID || "").trim();
const defaultFeishuId = (process.env.WF_003_FEISHU_ID || process.env.FEISHU_ID || "").trim();
const kieUploadUrl =
  (process.env.KIE_UPLOAD_URL || "https://kieai.riftrunnerai.com/api/file-stream-upload").trim();
const kieApiKey = (process.env.KIE_API_KEY || "").trim();
const qiniuAccessKey = (process.env.QINIU_ACCESS_KEY || "").trim();
const qiniuSecretKey = (process.env.QINIU_SECRET_KEY || "").trim();
const qiniuBucket = (process.env.QINIU_BUCKET || "").trim();
const qiniuDomain = (process.env.QINIU_DOMAIN || "").trim();
const qiniuUploadUrl = (process.env.QINIU_UPLOAD_URL || "https://upload.qiniup.com").trim();

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
  const defaultCallbackUrl = callbackBaseUrl
    ? `${callbackBaseUrl}/api/v1/workflow-runs/wf003-callback`
    : "";
  const payload = {
    kieUploadUrl: "/api/kie-upload",
    kieApiKey: "",
    workflowApiBase,
    workflowWebhookUrl,
    defaultCallbackUrl,
    defaultCallbackToken: callbackToken,
    defaultFeishuAppId,
    defaultFeishuId,
  };
  const body = `window.__WF003_CONFIG__ = ${JSON.stringify(payload)};\n`;
  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
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

function hasQiniuConfig() {
  return Boolean(qiniuAccessKey && qiniuSecretKey && qiniuBucket && qiniuDomain);
}

function toUrlSafeBase64(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function buildQiniuUploadToken() {
  const putPolicy = {
    scope: qiniuBucket,
    deadline: Math.floor(Date.now() / 1000) + 3600,
  };
  const encodedPolicy = toUrlSafeBase64(JSON.stringify(putPolicy));
  const sign = crypto.createHmac("sha1", qiniuSecretKey).update(encodedPolicy).digest();
  const encodedSign = toUrlSafeBase64(sign);
  return `${qiniuAccessKey}:${encodedSign}:${encodedPolicy}`;
}

function parseSingleUpload(req) {
  return new Promise((resolve, reject) => {
    let fileBuffer = null;
    let fileName = "";
    let mimeType = "application/octet-stream";
    let uploadPath = "";
    const chunks = [];

    const busboy = Busboy({ headers: req.headers });

    busboy.on("field", (fieldName, value) => {
      if (fieldName === "uploadPath") {
        uploadPath = String(value || "").trim();
      }
      if (fieldName === "fileName" && !fileName) {
        fileName = String(value || "").trim();
      }
    });

    busboy.on("file", (fieldName, file, info) => {
      if (fieldName !== "file") {
        file.resume();
        return;
      }
      fileName = fileName || info.filename || "upload.bin";
      mimeType = info.mimeType || mimeType;
      file.on("data", (chunk) => chunks.push(chunk));
      file.on("end", () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    busboy.on("error", reject);
    busboy.on("finish", () => {
      if (!fileBuffer || fileBuffer.length === 0) {
        reject(new Error("file is required"));
        return;
      }
      resolve({
        fileBuffer,
        fileName: fileName || "upload.bin",
        mimeType,
        uploadPath,
      });
    });

    req.pipe(busboy);
  });
}

function normalizeDomain(domain) {
  if (!domain) return "";
  if (/^https?:\/\//i.test(domain)) {
    return domain.replace(/^https?:\/\//i, "http://").replace(/\/+$/, "");
  }
  return `http://${domain.replace(/\/+$/, "")}`;
}

async function uploadToQiniu(req) {
  const upload = await parseSingleUpload(req);
  const safeName = upload.fileName.replace(/[^\w.\-]+/g, "_");
  const prefix = upload.uploadPath ? upload.uploadPath.replace(/^\/+|\/+$/g, "") : "wf003";
  const key = `${prefix}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeName}`;
  const token = buildQiniuUploadToken();

  const form = new FormData();
  form.append("token", token);
  form.append("key", key);
  form.append("file", upload.fileBuffer, { filename: safeName, contentType: upload.mimeType });

  const upstream = await axios.post(qiniuUploadUrl, form, {
    headers: form.getHeaders(),
    validateStatus: () => true,
  });

  if (upstream.status < 200 || upstream.status >= 300) {
    const msg = typeof upstream.data === "string" ? upstream.data : JSON.stringify(upstream.data);
    throw new Error(`Qiniu upload failed (${upstream.status}): ${msg.slice(0, 300)}`);
  }

  const publicBase = normalizeDomain(qiniuDomain);
  return {
    success: true,
    data: {
      downloadUrl: `${publicBase}/${key}`,
      key,
    },
  };
}

async function handleFileUploadProxy(req, res) {
  if (hasQiniuConfig()) {
    const data = await uploadToQiniu(req);
    sendJson(res, 200, data);
    return;
  }

  if (!kieUploadUrl) {
    sendJson(res, 502, {
      error: "kie_upload_url_missing",
      message: "KIE_UPLOAD_URL is not configured",
    });
    return;
  }

  const body = await readRequestBody(req);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers["content-length"];
  delete headers.origin;
  delete headers.referer;
  if (kieApiKey) {
    headers.authorization = `Bearer ${kieApiKey}`;
  }

  const upstream = await axios({
    url: kieUploadUrl,
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
}

async function proxyApiRequest(req, res, requestUrl) {
  let upstreamUrl = "";

  if (requestUrl.pathname === "/api/kie-upload") {
    await handleFileUploadProxy(req, res);
    return;
  } else if (requestUrl.pathname === "/api/v1/workflows/WF-003/json-execute") {
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
    if (workflowApiBase) {
      upstreamUrl = `${workflowApiBase}${requestUrl.pathname}${requestUrl.search}`;
    } else if (middlePlatformBase) {
      upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, `${middlePlatformBase}/`).toString();
    } else {
      sendJson(res, 502, {
        error: "workflow_api_base_missing",
        message: "Neither WORKFLOW_API_BASE nor MIDDLE_PLATFORM_BASE is configured",
      });
      return;
    }
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
  const isSubmit123 = Boolean(submitUpstream && /\/wf003-kie-submit-123(?:$|\?)/.test(submitUpstream.url));
  console.log(`car-export-portal running at http://localhost:${port}`);
  console.log(
    `WF-003 submit upstream: ${
      submitUpstream ? `${submitUpstream.source} -> ${submitUpstream.url}` : "not configured"
    }`,
  );
  console.log(`WF-003 submit routing check: ${isSubmit123 ? "using wf003-kie-submit-123" : "NOT using wf003-kie-submit-123"}`);
  if (!isSubmit123) {
    console.log(
      `routing env snapshot: WF_003_WEBHOOK_URL="${workflowWebhookUrl || ""}", WF_003_MIDDLE_PLATFORM_URL="${legacyMiddlePlatformUrl || ""}", WORKFLOW_API_BASE="${workflowApiBase || ""}", MIDDLE_PLATFORM_BASE="${middlePlatformBase || ""}", WORKFLOW_SUBMIT_PATH="${workflowSubmitPath || ""}"`,
    );
  }
});

