#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadDefaultEnvFiles() {
  const scriptDir = __dirname;
  const platformDir = path.resolve(scriptDir, '..');
  const repoRoot = path.resolve(platformDir, '..');

  loadEnvFile(path.join(repoRoot, '.env.docker'));
  loadEnvFile(path.join(platformDir, '.env'));
}

function printUsageAndExit() {
  console.error(
    [
      'Usage:',
      '  node scripts/import-wf003-logo.js <manufacturer_code> <manufacturer_name> <logo_path>',
      '',
      'Example:',
      '  node scripts/import-wf003-logo.js byd "BYD" ../WF-003/car-export-portal/logo/logo.png',
      '',
      'Database environment variables:',
      '  DATABASE_HOST, DATABASE_PORT, DATABASE_USERNAME, DATABASE_PASSWORD, DATABASE_NAME',
    ].join('\n'),
  );
  process.exit(1);
}

function normalizeManufacturerCode(value) {
  return value.trim().toLowerCase();
}

function detectMimeType(filePath, buffer) {
  const ext = path.extname(filePath).toLowerCase();

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 6 &&
    (buffer.slice(0, 6).toString('ascii') === 'GIF87a' ||
      buffer.slice(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return 'image/gif';
  }

  if (
    buffer.length >= 12 &&
    buffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  if (ext === '.svg') {
    return 'image/svg+xml';
  }

  if (ext === '.png') {
    return 'image/png';
  }

  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }

  if (ext === '.gif') {
    return 'image/gif';
  }

  if (ext === '.webp') {
    return 'image/webp';
  }

  throw new Error(
    'Unsupported logo file type. Use png, jpg, jpeg, gif, webp, or svg.',
  );
}

function getDatabaseConfig() {
  const host = process.env.DATABASE_HOST;
  const username = process.env.DATABASE_USERNAME;
  const password = process.env.DATABASE_PASSWORD;
  const database = process.env.DATABASE_NAME;
  const port = Number(process.env.DATABASE_PORT || 3306);

  const missing = [];
  if (!host) missing.push('DATABASE_HOST');
  if (!username) missing.push('DATABASE_USERNAME');
  if (!password) missing.push('DATABASE_PASSWORD');
  if (!database) missing.push('DATABASE_NAME');

  if (missing.length) {
    throw new Error(`Missing database env vars: ${missing.join(', ')}`);
  }

  return {
    host,
    port,
    user: username,
    password,
    database,
  };
}

async function main() {
  loadDefaultEnvFiles();

  const [manufacturerCodeArg, manufacturerNameArg, logoPathArg] =
    process.argv.slice(2);

  if (!manufacturerCodeArg || !manufacturerNameArg || !logoPathArg) {
    printUsageAndExit();
  }

  const manufacturerCode = normalizeManufacturerCode(manufacturerCodeArg);
  const manufacturerName = manufacturerNameArg.trim();
  const logoPath = path.resolve(process.cwd(), logoPathArg);

  if (!manufacturerCode) {
    throw new Error('manufacturer_code is required');
  }

  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(manufacturerCode)) {
    throw new Error(
      'manufacturer_code must use lowercase letters, numbers, underscore, or hyphen, and be 1-64 chars',
    );
  }

  if (!manufacturerName) {
    throw new Error('manufacturer_name is required');
  }

  if (!fs.existsSync(logoPath)) {
    throw new Error(`Logo file not found: ${logoPath}`);
  }

  const logoContent = fs.readFileSync(logoPath);
  const logoMimeType = detectMimeType(logoPath, logoContent);
  const logoSha256 = crypto
    .createHash('sha256')
    .update(logoContent)
    .digest('hex');
  const logoFileName = path.basename(logoPath);

  const connection = await mysql.createConnection(getDatabaseConfig());

  try {
    await connection.execute(
      `
        INSERT INTO wf_003_manufacturer_logos (
          manufacturer_code,
          manufacturer_name,
          logo_file_name,
          logo_mime_type,
          logo_content,
          logo_sha256,
          is_active
        ) VALUES (?, ?, ?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
          manufacturer_name = VALUES(manufacturer_name),
          logo_file_name = VALUES(logo_file_name),
          logo_mime_type = VALUES(logo_mime_type),
          logo_public_url = NULL,
          logo_content = VALUES(logo_content),
          logo_sha256 = VALUES(logo_sha256),
          is_active = 1,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        manufacturerCode,
        manufacturerName,
        logoFileName,
        logoMimeType,
        logoContent,
        logoSha256,
      ],
    );
  } finally {
    await connection.end();
  }

  console.log(
    JSON.stringify(
      {
        imported: true,
        manufacturer_code: manufacturerCode,
        manufacturer_name: manufacturerName,
        logo_file_name: logoFileName,
        logo_mime_type: logoMimeType,
        logo_sha256: logoSha256,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
