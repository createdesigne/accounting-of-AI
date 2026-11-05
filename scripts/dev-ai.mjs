import { createServer } from 'vite';

// Public local backend address only. No credentials are exposed to Vite.
process.env.VITE_AI_SERVER_URL = '/api/ai';
const server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
await server.listen();
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
