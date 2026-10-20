#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const skippedDirectories = new Set(['node_modules', '.expo', 'android', 'ios', 'tests', 'coverage']);
const allowedFiles = new Set([
  path.join('lib', 'api-client.ts'),
  path.join('scripts', 'verify-api-client-boundary.mjs'),
]);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const forbiddenPatterns = [
  { label: 'direct fetch()', pattern: /\bfetch\s*\(/g },
  { label: 'alternative JSON/network client', pattern: /\b(?:fetchJson|authorizedFetch)\b/g },
  { label: 'Axios transport', pattern: /\baxios\s*\.(?:request|get|post|put|patch|delete)\s*\(/g },
  { label: 'XMLHttpRequest transport', pattern: /\bnew\s+XMLHttpRequest\s*\(/g },
];

const violations = [];

async function scanDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath);

    if (entry.isDirectory()) {
      await scanDirectory(absolutePath);
      continue;
    }
    if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) continue;
    if (allowedFiles.has(relativePath)) continue;

    const source = await readFile(absolutePath, 'utf8');
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      for (const rule of forbiddenPatterns) {
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(lines[index])) {
          violations.push(relativePath + ':' + String(index + 1) + ' uses ' + rule.label);
        }
      }
    }
  }
}

await scanDirectory(root);

if (violations.length > 0) {
  console.error('Native API boundary violation(s) found:');
  for (const violation of violations) console.error('  - ' + violation);
  console.error('Use apiRequest from ~/lib/api-client for LuckRead API requests. Do not add a parallel client.');
  process.exitCode = 1;
} else {
  console.log('Native API boundary verified: feature code uses the shared api-client transport.');
}
