import { createAiHandler } from './app.mjs';
import { providerFromEnvironment } from './gemini.mjs';

// Use configured Vercel hosts, never an untrusted Host/forwarded header.
export function createVercelHandler(env = process.env, dependencies = {}) {
  let handler;
  return async (req, res) => {
    try {
      if (!handler) {
        const origins = new Set(['https://accounting-of-ai.vercel.app']);
        for (const host of [env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
          if (!host) continue;
          if (!/^[a-zA-Z0-9.-]+\.vercel\.app$/.test(host)) throw new Error('Invalid deployment host');
          origins.add(`https://${host}`);
        }
        // Custom domains must be explicitly configured as origins.
        for (const origin of (env.AI_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)) origins.add(origin);
        handler = createAiHandler({ provider: providerFromEnvironment(env, dependencies), allowedOrigins: [...origins] });
      }
    } catch {
      // Configuration errors must not leak keys, SDK errors or environment values.
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ error: { code: 'AI_NOT_CONFIGURED' } }));
      return;
    }
    return handler(req, res);
  };
}
