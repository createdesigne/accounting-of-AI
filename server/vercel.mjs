import { createAiHandler } from './app.mjs';
import { createGeminiProvider } from './gemini.mjs';

export function vercelOrigins(env) {
  const origins = [];
  for (const name of ['VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_BRANCH_URL']) {
    const host = env[name];
    if (host) {
      if (!/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error('Invalid deployment origin');
      origins.push(`https://${host}`);
    }
  }
  if (env.PUBLIC_ORIGIN) {
    const url = new URL(env.PUBLIC_ORIGIN);
    if (url.protocol !== 'https:' || url.origin !== env.PUBLIC_ORIGIN) throw new Error('Invalid public origin');
    origins.push(url.origin);
  }
  return [...new Set(origins)];
}

// One handler per warm function instance; credentials are still request scoped.
// The two-request bound is per instance, not a distributed quota across Vercel.
const handler = createAiHandler({ providerFactory: createGeminiProvider, allowedOrigins: vercelOrigins(process.env) });
export default handler;
