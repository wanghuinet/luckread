#!/usr/bin/env node
/**
 * Static admission guard for the APP / H5 / PC development contract.
 * Uses only Node.js built-ins so it can run before installing app dependencies.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const info = [];
const fail = (message) => errors.push(message);

const contractPath = path.join(root, 'contracts/frontend/THREE-CLIENT-DEVELOPMENT-CONTRACT.v1.0.md');
let contractText = '';
try {
  contractText = await readFile(contractPath, 'utf8');
} catch (error) {
  fail('Cannot read required contract: ' + error.message);
}

for (const required of [
  'API-001',
  'AUTHORITY-001',
  'ASYNC-001',
  'REVIEW-001',
  'https://api.luckread.com/v1',
  'APP、H5、PC',
  '合并阻断规则',
]) {
  if (!contractText.includes(required)) fail('Contract is missing required rule/decision: ' + required);
}

const appClientPath = path.join(root, 'app/lib/api-client.ts');
let appClient = '';
try {
  appClient = await readFile(appClientPath, 'utf8');
} catch (error) {
  fail('Cannot read APP shared API client: ' + error.message);
}

if (!/DEFAULT_API_BASE_URL\s*=\s*['"]https:\/\/api\.luckread\.com['"]/.test(appClient)) {
  fail('APP shared API client default base URL must be https://api.luckread.com');
}
if (!/getApiBaseUrl\(\)\s*\+\s*['"]\/v1['"]/.test(appClient)) {
  fail('APP shared API client must compose public routes under /v1');
}

const appBoundary = path.join(root, 'app/scripts/verify-api-client-boundary.mjs');
try {
  await stat(appBoundary);
  const result = spawnSync(process.execPath, [appBoundary], {
    cwd: path.join(root, 'app'),
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail('Could not run APP API-boundary checker: ' + result.error.message);
  if (result.status !== 0) fail('APP API-boundary checker failed with exit code ' + result.status);
} catch (error) {
  fail('Required APP API-boundary checker is missing/unreadable: ' + error.message);
}

const uiRoots = [
  'workers/W01-payload/src/app/(frontend)',
  'workers/W01-payload/src/app/(twitter-clone)',
  'workers/W01-payload/src/app/(payload)',
];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const skipDirs = new Set(['node_modules', '.next', '.open-next', 'coverage', '__tests__', 'fixtures']);
const sourceFiles = [];

const nonUiRouteRoots = new Set([
  'workers/W01-payload/src/app/(payload)/api',
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    // Route handlers under this App Router group are server-side API entrypoints,
    // not page/component code. Keep them outside the UI-only boundary scan.
    if (entry.isDirectory() && (skipDirs.has(entry.name) || nonUiRouteRoots.has(relative))) continue;
    if (entry.isDirectory()) {
      await walk(absolute);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name)) &&
      !/\.(?:test|spec)\.[^.]+$/.test(entry.name)) {
      sourceFiles.push(absolute);
    }
  }
}

for (const relativeRoot of uiRoots) {
  const absoluteRoot = path.join(root, relativeRoot);
  try {
    if (!(await stat(absoluteRoot)).isDirectory()) {
      fail('Expected W01 UI source directory is not a directory: ' + relativeRoot);
      continue;
    }
    await walk(absoluteRoot);
  } catch (error) {
    fail('Cannot scan W01 UI source directory ' + relativeRoot + ': ' + error.message);
  }
}

const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/gm, (match, prefix) => prefix + ' '.repeat(Math.max(0, match.length - prefix.length)));

const forbidden = [
  {
    label: 'database/SQL client import in UI code',
    pattern: /\bfrom\s*['"](?:@payloadcms\/db-d1-sqlite|drizzle-orm(?:\/[^'"]*)?|better-sqlite3|sqlite3|@libsql\/client|node:sqlite|@prisma\/client|pg|mysql2|mongoose|@supabase\/supabase-js)['"]/g,
  },
  {
    label: 'D1 binding/type access in UI code',
    pattern: /\bD1Database\b|\bD1_\d+\b|\b(?:env|cloudflareEnv)\.(?:D1(?:_\d+)?|DB|DATABASE)\b/g,
  },
  {
    label: 'Payload Local API invoked directly from UI code',
    pattern: /\bgetPayload\s*\(|\bpayload\.(?:find|findByID|findGlobal|create|update|delete|count)\s*\(/g,
  },
  {
    label: 'W01 API route handler imported directly into UI instead of the public API client',
    pattern: /\bimport\s*\{[^}]*\b(?:GET|POST|PUT|PATCH|DELETE)\b[^}]*\}\s*from\s*['"][^'"]*\/api\/v1\/[^'"]*\/route(?:\.[^'"]+)?['"]/g,
  },
  {
    label: 'W03 content service invoked directly from UI instead of the public W01 API',
    pattern: /\bcallW03Content\s*\(|\bfrom\s*['"][^'"]*\/content\/w03-content-client(?:\.js)?['"]/g,
  },
  {
    label: 'private domain Worker client imported directly from UI instead of the W01 public API',
    pattern: /\bfrom\s*['"][^'"]*\/(?:w02-session-client|w04-feed-client|w05-social-client|w06-moderation-client|w07-subscription-client|w08-creator-client|w11-analytics-client)(?:\.js)?['"]/g,
  },
  {
    label: 'private Worker internal URL referenced from UI code',
    pattern: /https?:\/\/[A-Za-z0-9.-]+\.internal(?:\/|['"])/g,
  },
];

for (const file of sourceFiles) {
  let source;
  try {
    source = stripComments(await readFile(file, 'utf8'));
  } catch (error) {
    fail('Cannot read UI source ' + path.relative(root, file) + ': ' + error.message);
    continue;
  }
  const relativeFile = path.relative(root, file).split(path.sep).join('/');
  for (const rule of forbidden) {
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      const index = match.index ?? 0;
      const line = source.slice(0, index).split(/\r?\n/).length;
      fail(relativeFile + ':' + line + ' violates UI boundary: ' + rule.label);
    }
  }
}

info.push('W01_UI_FILES_SCANNED=' + sourceFiles.length);
info.push('UI_DATABASE_BOUNDARY_RULES=' + forbidden.length);
info.push('CONTRACT_STATIC_GUARD_SCOPE=APP transport + W01 UI database/Local-API/direct-route/private-Worker boundary');
for (const line of info) console.log(line);

if (errors.length) {
  console.error('THREE_CLIENT_DEVELOPMENT_CONTRACT=FAIL');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}
console.log('THREE_CLIENT_DEVELOPMENT_CONTRACT=PASS');
