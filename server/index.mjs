import { createAiServer } from './app.mjs';
import { providerFromEnvironment } from './gemini.mjs';

const port = Number(process.env.AI_SERVER_PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid AI_SERVER_PORT');
const allowedOrigins = (process.env.AI_ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean);
const server = createAiServer({ provider: providerFromEnvironment(process.env), allowedOrigins });
server.on('error', () => { console.error('AI server could not start. Check the port and settings.'); process.exitCode = 1; });
// Local preparation only. Public hosting requires authentication and a separate approval.
server.listen(port, '127.0.0.1', () => console.log(`AI server: http://127.0.0.1:${port}/api/ai/health`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
