import { writeFileSync, mkdirSync } from 'fs';

const buildId = process.env.VERCEL_GIT_COMMIT_SHA || process.env.APP_BUILD_ID || Date.now().toString();

mkdirSync('dist', { recursive: true });
writeFileSync('dist/version.json', JSON.stringify({ buildId }));
console.log(`[write-version] dist/version.json buildId=${buildId}`);
