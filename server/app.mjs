import { createServer } from 'node:http';
import { AiError, parseInput, parseResult } from './contract.mjs';

const ERROR_STATUS = {
  API_KEY_REQUIRED: 401, INVALID_CREDENTIALS: 400,
  INVALID_INPUT: 400, TOO_LARGE: 413, FORBIDDEN: 403, NOT_FOUND: 404, METHOD_NOT_ALLOWED: 405,
  AI_NOT_CONFIGURED: 503, BUSY: 429, RATE_LIMITED: 429, AUTH_ERROR: 502, MODEL_UNAVAILABLE: 503,
  CONTENT_BLOCKED: 422, OUTPUT_TRUNCATED: 502, INVALID_OUTPUT: 502, PROVIDER_ERROR: 502, TIMEOUT: 504,
};

export function createAiServer({ provider = null, providerFactory = null, staticHandler = null, allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173'], timeoutMs = 15000, maxConcurrent = 2 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 10) throw new AiError('INVALID_CONFIG');
  if (provider !== null && typeof provider?.rewrite !== 'function') throw new AiError('INVALID_CONFIG');
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some(origin => {
    try { const u = new URL(origin); return u.origin !== origin || !['http:', 'https:'].includes(u.protocol); } catch { return true; }
  })) throw new AiError('INVALID_CONFIG');
  let active = 0;
  const server = createServer(async (req, res) => {
    const reply = (code, data) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(code ? ERROR_STATUS[code] : 200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(code ? { error: { code } } : data));
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    const path = req.url?.split('?')[0];
    if (staticHandler && !path?.startsWith('/api/')) return staticHandler(req, res);
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.includes(origin)) return reply('FORBIDDEN');
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    if (!['/api/ai/health', '/api/ai/rewrite'].includes(path)) return reply('NOT_FOUND');
    const method = path.endsWith('/health') ? 'GET' : 'POST';
    if (req.method === 'OPTIONS') {
      const requested = req.headers['access-control-request-method'];
      const headers = (req.headers['access-control-request-headers'] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if ((requested && requested !== method) || headers.some(h => !['content-type', 'authorization', 'x-gemini-model'].includes(h))) return reply('FORBIDDEN');
      res.writeHead(204, { 'Access-Control-Allow-Methods': method, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gemini-Model' }); return res.end();
    }
    if (req.method !== method) { res.setHeader('Allow', method); return reply('METHOD_NOT_ALLOWED'); }
    if (method === 'GET' && providerFactory) return reply(null, { status: 'requires_key', configured: false, credentialMode: 'per_request' });
    if (method === 'GET') return reply(null, { status: provider ? 'configured' : 'disabled', configured: !!provider });
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply('INVALID_INPUT');
    let input;
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 32 * 1024) { reply('TOO_LARGE'); req.resume(); return; }
        chunks.push(chunk);
      }
      input = parseInput(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch { return reply('INVALID_INPUT'); }
    if (!input) return reply('INVALID_INPUT');
    let requestProvider = provider;
    if (providerFactory) {
      const authorization = req.headers.authorization;
      if (!authorization) return reply('API_KEY_REQUIRED');
      const match = /^Bearer ([\x21-\x7e]{1,512})$/.exec(authorization);
      const model = req.headers['x-gemini-model'];
      if (!match || typeof model !== 'string' || !/^gemini-[a-zA-Z0-9._-]{1,120}$/.test(model)) return reply('INVALID_CREDENTIALS');
      try { requestProvider = providerFactory({ apiKey: match[1], model }); }
      catch { return reply('INVALID_CREDENTIALS'); }
    }
    if (!requestProvider) return reply('AI_NOT_CONFIGURED');
    if (active >= maxConcurrent) return reply('BUSY');
    active++;
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    let timer;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AiError('TIMEOUT')); }, timeoutMs); });
      const result = parseResult(await Promise.race([Promise.resolve().then(() => requestProvider.rewrite(input, { signal: controller.signal })), timeout]));
      if (!result) throw new AiError('INVALID_OUTPUT');
      reply(null, result);
    } catch (error) {
      // Only our finite error codes may cross the boundary, never raw provider errors.
      reply(controller.signal.aborted ? 'TIMEOUT'
        : error instanceof AiError && Object.hasOwn(ERROR_STATUS, error.code) ? error.code : 'PROVIDER_ERROR');
    } finally { clearTimeout(timer); res.off('close', disconnect); active--; }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}
