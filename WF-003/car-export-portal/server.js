const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const host = "0.0.0.0";
const port = process.env.PORT ? Number(process.env.PORT) : 3001;
const rootDir = __dirname;

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
  };
  const body = `window.__WF003_CONFIG__ = ${JSON.stringify(payload)};\n`;
  res.writeHead(200, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
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
  console.log(`car-export-portal running at http://localhost:${port}`);
});
