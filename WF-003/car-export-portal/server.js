const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const axios = require("axios");

const host = "0.0.0.0";
const port = process.env.PORT ? Number(process.env.PORT) : 3001;
const rootDir = __dirname;
const workflowApiBase = (process.env.WORKFLOW_API_BASE || "").replace(/\/$/, "");
const workflowSubmitPath = process.env.WORKFLOW_SUBMIT_PATH || "/webhook/wf003-kie-submit";
const legacyMiddlePlatformUrl = (process.env.WF_003_MIDDLE_PLATFORM_URL || "").replace(/\/$/, "");
const workflowWebhookUrl = (process.env.WF_003_WEBHOOK_URL || "").replace(/\/$/, "");

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
    kieUploadUrl:
      process.env.KIE_UPLOAD_URL ||
      "https://kieai.redpandaai.co/api/file-stream-upload",
    kieApiKey: process.env.KIE_API_KEY || "",
    workflowApiBase,
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
