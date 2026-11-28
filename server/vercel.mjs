import { createAiHandler } from './app.mjs';
import { createGeminiProvider } from './gemini.mjs';
import { createResearchParticipantAccess } from './research-participant-access.mjs';

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

// Personal credentials remain request scoped. Participant credentials are verified
// server-side and metered by the configured persistent Redis service.
const handler = createAiHandler({
  providerFactory: createGeminiProvider,
  participantAccess: createResearchParticipantAccess(process.env),
  allowedOrigins: vercelOrigins(process.env),
});
export default handler;
