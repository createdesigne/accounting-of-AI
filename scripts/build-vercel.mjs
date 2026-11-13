import { spawnSync } from 'node:child_process';

// Public API URL only. Keep all Gemini settings in the server environment.
const result = spawnSync('pnpm', ['build'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_AI_SERVER_URL: '/api/ai' },
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
