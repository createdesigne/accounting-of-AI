import { fileURLToPath } from 'node:url';
import { createAiServer } from './app.mjs';
import { createGeminiProvider } from './gemini.mjs';
import { createStaticHandler } from './static.mjs';

const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || process.env.AI_SERVER_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port');
const publicOrigin = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
if (production && !publicOrigin?.startsWith('https://')) throw new Error('Set PUBLIC_ORIGIN to the public HTTPS origin');
const allowedOrigins = production ? [publicOrigin] : ['http://127.0.0.1:5173', 'http://localhost:5173', `http://127.0.0.1:${port}`, `http://localhost:${port}`, ...(publicOrigin ? [publicOrigin] : [])];
// No environment key fallback: every caller must supply their own credentials.
const server = createAiServer({ providerFactory: createGeminiProvider, allowedOrigins,
  staticHandler: createStaticHandler(fileURLToPath(new URL('../dist', import.meta.url))) });
server.on('error', () => { console.error('AI server could not start. Check the port and settings.'); process.exitCode = 1; });
server.listen(port, production ? '0.0.0.0' : '127.0.0.1', () => console.log(`App server listening on port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
