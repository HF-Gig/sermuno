import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'src');
const FILE_EXTENSIONS = new Set(['.ts', '.tsx']);
const VIOLATION_PATTERNS = [
  /\b(?:loading|pendingLoading|orgNotificationLoading|notificationsLoading)\b[\s\S]{0,120}?Array\.from\(\{\s*length:\s*\d+\s*\}/g,
];

const EXCLUDED_PATH_SNIPPETS = [
  `${path.sep}i18n.ts`,
];

const walk = (dir, files = []) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (!FILE_EXTENSIONS.has(path.extname(entry.name))) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
};

const files = walk(ROOT).filter((filePath) => !EXCLUDED_PATH_SNIPPETS.some((snippet) => filePath.includes(snippet)));
const violations = [];

for (const filePath of files) {
  const source = fs.readFileSync(filePath, 'utf8');
  for (const pattern of VIOLATION_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const offset = match.index ?? 0;
      const before = source.slice(0, offset);
      const line = before.split('\n').length;
      violations.push({
        file: path.relative(process.cwd(), filePath),
        line,
        snippet: match[0].split('\n').map((lineValue) => lineValue.trim()).join(' ').slice(0, 180),
      });
    }
  }
}

if (violations.length > 0) {
  console.error('Found hardcoded skeleton count patterns in loading branches:');
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} -> ${violation.snippet}`);
  }
  process.exit(1);
}

console.log('Skeleton hardcoding check passed.');
