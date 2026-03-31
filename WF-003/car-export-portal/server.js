const http = require("http");
const fs = require("fs");
const path = require("path");
const Busboy = require("busboy");
const axios = require("axios");
const FormData = require("form-data");
const { URL } = require("url");

const host = "0.0.0.0";
const port = process.env.PORT ? Number(process.env.PORT) : 3001;
const rootDir = __dirname;
const uploadsDir = path.join(rootDir, "uploads");
const webhookUrl =
  process.env.CAR_EXPORT_WEBHOOK_URL ||
  "https://n8n.deepsix.store/webhook/bda7b6ac-10b6-4467-b6fd-83dd68c0bbd9";
const middlePlatformUrl =
  process.env.WF_003_MIDDLE_PLATFORM_URL ||
  "http://127.0.0.1:3002/api/v1/workflows/WF-003/upload-execute";

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

fs.mkdirSync(uploadsDir, { recursive: true });

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
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

function parseMultipartForm(req) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    const busboy = Busboy({
      headers: req.headers,
    });

    busboy.on("field", (name, value) => {
      if (fields[name] === undefined) {
        fields[name] = value;
        return;
      }

      if (Array.isArray(fields[name])) {
        fields[name].push(value);
        return;
      }

      fields[name] = [fields[name], value];
    });

    busboy.on("file", (name, file, info) => {
      const chunks = [];
      file.on("data", (chunk) => chunks.push(chunk));
      file.on("error", reject);
      file.on("end", () => {
        files.push({
          fieldName: name,
          filename: info.filename || "file.bin",
          mimeType: info.mimeType || "application/octet-stream",
          buffer: Buffer.concat(chunks),
        });
      });
    });

    busboy.on("error", reject);
    busboy.on("close", () => resolve({ fields, files }));
    req.pipe(busboy);
  });
}

function getPublicBaseUrl(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || "http";
  const hostHeader = forwardedHost || req.headers.host;
  return `${protocol}://${hostHeader}`;
}

function sanitizeFileName(fileName) {
  const ext = path.extname(String(fileName || ""));
  const base = path.basename(String(fileName || "file"), ext);
  const safeBase = base
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "file";
  return `${safeBase}${ext.toLowerCase() || ".bin"}`;
}

async function saveUploadedFiles(parsed, req) {
  const baseUrl = getPublicBaseUrl(req);
  const result = {
    carName: String(parsed.fields.car_name || ""),
    exteriorImages: [],
    interiorImages: [],
    logo: null,
    allFiles: [],
  };

  for (const file of parsed.files) {
    const savedName = `${Date.now()}-${Math.random()
      .toString(16)
      .slice(2, 8)}-${sanitizeFileName(file.filename)}`;
    const filePath = path.join(uploadsDir, savedName);
    fs.writeFileSync(filePath, file.buffer);

    const fileInfo = {
      fieldName: file.fieldName,
      originalName: file.filename,
      savedName,
      url: `${baseUrl}/uploads/${encodeURIComponent(savedName)}`,
    };

    result.allFiles.push(fileInfo);

    if (file.fieldName === "exterior_images") {
      result.exteriorImages.push(fileInfo);
    } else if (file.fieldName === "interior_images") {
      result.interiorImages.push(fileInfo);
    } else if (file.fieldName === "logo") {
      result.logo = fileInfo;
    }
  }

  return result;
}

async function forwardToWebhook(parsed) {
  if (!webhookUrl || webhookUrl === "PASTE_YOUR_N8N_WEBHOOK_URL_HERE") {
    throw new Error("server webhook is not configured");
  }

  // 先声明变量
  const outbound = new FormData();
  let exteriorIndex = 1;
  let interiorIndex = 1;
  let exteriorCount = 0;
  let interiorCount = 0;

  // 添加 car_name
  if (parsed.fields.car_name) {
    outbound.append("car_name", String(parsed.fields.car_name));
  }

  // 处理文件
  for (const file of parsed.files) {
    if (file.fieldName === "exterior_images") {
      exteriorCount++;
      outbound.append(`exterior_${exteriorIndex}`, file.buffer, {
        filename: file.filename,
        contentType: file.mimeType,
      });
      exteriorIndex++;
    } 
    else if (file.fieldName === "interior_images") {
      interiorCount++;
      outbound.append(`interior_${interiorIndex}`, file.buffer, {
        filename: file.filename,
        contentType: file.mimeType,
      });
      interiorIndex++;
    } 
    else {
      outbound.append(file.fieldName, file.buffer, {
        filename: file.filename,
        contentType: file.mimeType,
      });
    }
  }

  // 添加文件数量信息
  const fileCounts = {
    exterior: exteriorCount,
    interior: interiorCount
  };
  outbound.append("_file_counts", JSON.stringify(fileCounts));

  // 发送请求
  const response = await axios.post(webhookUrl, outbound, {
    headers: outbound.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    const message = typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data);
    throw new Error(`webhook request failed (${response.status}) ${message}`);
  }

  return response.data;
}

async function forwardToMiddlePlatform(parsed, authorization) {
  if (!authorization) {
    throw new Error("missing authorization token");
  }

  const outbound = new FormData();

  if (parsed.fields.car_name) {
    outbound.append("car_name", String(parsed.fields.car_name));
  }

  for (const file of parsed.files) {
    if (
      file.fieldName !== "exterior_images" &&
      file.fieldName !== "interior_images" &&
      file.fieldName !== "logo"
    ) {
      continue;
    }

    outbound.append(file.fieldName, file.buffer, {
      filename: file.filename,
      contentType: file.mimeType,
    });
  }

  const response = await axios.post(middlePlatformUrl, outbound, {
    headers: {
      ...outbound.getHeaders(),
      Authorization: authorization,
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    const message =
      typeof response.data === "string"
        ? response.data
        : JSON.stringify(response.data);
    throw new Error(`middle platform request failed (${response.status}) ${message}`);
  }

  return response.data;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/car-export-submit") {
    try {
      const parsed = await parseMultipartForm(req);
      const authorization = String(req.headers.authorization || "").trim();
      if (!authorization) {
        sendJson(res, 401, {
          error: "missing authorization token, please enter from client portal",
        });
        return;
      }
      const uploaded = await saveUploadedFiles(parsed, req);
      const workflow = await forwardToMiddlePlatform(parsed, authorization);
      sendJson(res, 200, {
        ok: true,
        uploaded,
        workflow,
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(res, url.pathname);
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(port, host, () => {
  console.log(`car-export-portal running at http://localhost:${port}`);
});
