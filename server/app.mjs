import { createServer } from 'node:http';
import { AiError, parseInput, parseResult } from './contract.mjs';
import {
  createWeeklyFailureResponse,
  parseWeeklyAnalysisRequest,
  parseWeeklyAnalysisResponse,
  WEEKLY_ANALYSIS_PROVIDER_API_VERSION,
  WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION,
  WEEKLY_ANALYSIS_API_METHODS,
  WEEKLY_ANALYSIS_REQUEST_LIMIT,
} from './weekly-analysis-contract.mjs';

const ERROR_STATUS = {
  API_KEY_REQUIRED: 401, INVALID_CREDENTIALS: 400,
  INVALID_INPUT: 400, TOO_LARGE: 413, FORBIDDEN: 403, NOT_FOUND: 404, METHOD_NOT_ALLOWED: 405,
  AI_NOT_CONFIGURED: 503, BUSY: 429, RATE_LIMITED: 429, AUTH_ERROR: 502, MODEL_UNAVAILABLE: 503,
  CONTENT_BLOCKED: 422, OUTPUT_TRUNCATED: 502, INVALID_OUTPUT: 502, PROVIDER_ERROR: 502, TIMEOUT: 504,
  NOT_AUTHENTICATED: 401, NOT_AUTHORIZED: 403,
};

export function createAiHandler({ provider = null, providerFactory = null, staticHandler = null, allowedOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174'], timeoutMs = 15000, maxConcurrent = 2 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 10) throw new AiError('INVALID_CONFIG');
  if (provider !== null && typeof provider?.rewrite !== 'function' && typeof provider?.analyzeWeekly !== 'function') throw new AiError('INVALID_CONFIG');
  if (!Array.isArray(allowedOrigins) || allowedOrigins.some(origin => {
    try { const u = new URL(origin); return u.origin !== origin || !['http:', 'https:'].includes(u.protocol); } catch { return true; }
  })) throw new AiError('INVALID_CONFIG');
  let active = 0;
  return async (req, res) => {
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
    if (!['/api/ai/health', '/api/ai/rewrite', '/api/ai/test-structured', '/api/ai/analyze-weekly'].includes(path)) return reply('NOT_FOUND');
    const weeklyAnalysis = path === '/api/ai/analyze-weekly';
    const structuredTest = path === '/api/ai/test-structured';
    const method = path.endsWith('/health') ? 'GET' : 'POST';
    if (req.method === 'OPTIONS') {
      const requested = req.headers['access-control-request-method'];
      const headers = (req.headers['access-control-request-headers'] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      if ((requested && requested !== method) || headers.some(h => !['content-type', 'authorization', 'x-gemini-model', 'x-gemini-api-method'].includes(h))) return reply('FORBIDDEN');
      res.writeHead(204, { 'Access-Control-Allow-Methods': method, 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gemini-Model, X-Gemini-Api-Method' }); return res.end();
    }
    if (req.method !== method) { res.setHeader('Allow', method); return reply('METHOD_NOT_ALLOWED'); }
    if (method === 'GET' && providerFactory) return reply(null, { status: 'requires_key', configured: false, credentialMode: 'per_request' });
    if (method === 'GET') return reply(null, { status: provider ? 'configured' : 'disabled', configured: !!provider });
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply('INVALID_INPUT');
    let input;
    try {
      const bodyLimit = weeklyAnalysis ? WEEKLY_ANALYSIS_REQUEST_LIMIT : structuredTest ? 1024 : 32 * 1024;
      const declaredLength = Number(req.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > bodyLimit) return reply('TOO_LARGE');
      // Vercel exposes a lazily parsed body after consuming the original stream.
      // Plain Node requests continue through the bounded raw-stream path.
      if ('body' in req) {
        const body = req.body;
        const serialized = typeof body === 'string' ? body : JSON.stringify(body);
        if (typeof serialized !== 'string') return reply('INVALID_INPUT');
        if (Buffer.byteLength(serialized, 'utf8') > bodyLimit) return reply('TOO_LARGE');
        const value = typeof body === 'string' ? JSON.parse(body) : body;
        input = weeklyAnalysis ? parseWeeklyAnalysisRequest(value) : structuredTest ? parseStructuredTest(value) : parseInput(value);
      } else {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > bodyLimit) { reply('TOO_LARGE'); req.resume(); return; }
        chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      input = weeklyAnalysis ? parseWeeklyAnalysisRequest(value) : structuredTest ? parseStructuredTest(value) : parseInput(value);
      }
    } catch { return reply('INVALID_INPUT'); }
    if (!input) return reply('INVALID_INPUT');
    let requestProvider = provider;
    if (providerFactory) {
      const authorization = req.headers.authorization;
      if (!authorization) return reply('API_KEY_REQUIRED');
      const match = /^Bearer ([\x21-\x7e]{1,512})$/.exec(authorization);
      const model = req.headers['x-gemini-model'];
      const apiMethod = req.headers['x-gemini-api-method'] ?? 'interactions';
      if (!match || typeof model !== 'string' || !/^gemini-[a-zA-Z0-9._-]{1,120}$/.test(model)
        || typeof apiMethod !== 'string' || !WEEKLY_ANALYSIS_API_METHODS.includes(apiMethod)) return reply('INVALID_CREDENTIALS');
      try { requestProvider = providerFactory({ apiKey: match[1], model, apiMethod }); }
      catch { return reply('INVALID_CREDENTIALS'); }
    }
    if (!requestProvider) return reply('AI_NOT_CONFIGURED');
    if (weeklyAnalysis && typeof requestProvider.analyzeWeekly !== 'function') return reply('AI_NOT_CONFIGURED');
    if (structuredTest && typeof requestProvider.testStructured !== 'function') return reply('AI_NOT_CONFIGURED');
    if (!weeklyAnalysis && !structuredTest && typeof requestProvider.rewrite !== 'function') return reply('AI_NOT_CONFIGURED');
    if (active >= maxConcurrent) return reply('BUSY');
    active++;
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    req.on('error', disconnect);
    let timer;
    try {
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new AiError('TIMEOUT', { diagnosticStage: 'provider-response', timedOut: true })); }, timeoutMs); });
      const rawResult = await Promise.race([Promise.resolve().then(() => weeklyAnalysis
        ? requestProvider.analyzeWeekly(input, { signal: controller.signal })
        : structuredTest ? requestProvider.testStructured(input, { signal: controller.signal })
        : requestProvider.rewrite(input, { signal: controller.signal })), timeout]);
      const result = weeklyAnalysis ? parseWeeklyAnalysisResponse(rawResult)
        : structuredTest ? parseStructuredTestResult(rawResult) : parseResult(rawResult);
      if (!result) throw new AiError('INVALID_OUTPUT');
      reply(null, result);
    } catch (error) {
      // Only our finite error codes may cross the boundary, never raw provider errors.
      const code = controller.signal.aborted ? 'TIMEOUT'
        : error instanceof AiError && Object.hasOwn(ERROR_STATUS, error.code) ? error.code : 'PROVIDER_ERROR';
      if (weeklyAnalysis) {
        const analysisCode = code === 'AUTH_ERROR' ? 'NOT_AUTHENTICATED'
          : code === 'BUSY' ? 'RATE_LIMITED'
          : code === 'OUTPUT_TRUNCATED' ? 'INVALID_OUTPUT'
          : ['INVALID_INPUT', 'NOT_AUTHORIZED', 'TOO_LARGE', 'RATE_LIMITED', 'MODEL_UNAVAILABLE', 'CONTENT_BLOCKED', 'INVALID_OUTPUT', 'TIMEOUT', 'PROVIDER_ERROR'].includes(code)
            ? code : 'PROVIDER_ERROR';
        const model = typeof req.headers['x-gemini-model'] === 'string' ? req.headers['x-gemini-model'] : 'gemini-unknown';
        const apiMethod = typeof req.headers['x-gemini-api-method'] === 'string' && WEEKLY_ANALYSIS_API_METHODS.includes(req.headers['x-gemini-api-method'])
          ? req.headers['x-gemini-api-method'] : 'interactions';
        const diagnosticStage = typeof error?.diagnosticStage === 'string' ? error.diagnosticStage : undefined;
        try { return reply(null, createWeeklyFailureResponse(input, analysisCode, {
          model,
          apiMethod,
          diagnosticStage,
          providerHttpStatus: error?.providerHttpStatus,
          providerErrorCode: error?.providerErrorCode,
          timedOut: typeof error?.timedOut === 'boolean' ? error.timedOut : code === 'TIMEOUT',
          providerApiVersion: WEEKLY_ANALYSIS_PROVIDER_API_VERSION,
          providerSdkVersion: WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION,
          validationField: error?.validationField,
          validationRule: error?.validationRule,
        })); }
        catch { return reply('PROVIDER_ERROR'); }
      }
      reply(code);
    } finally { clearTimeout(timer); res.off('close', disconnect); req.off('error', disconnect); active--; }
  };
}

export function createAiServer(options = {}) {
  const server = createServer(createAiHandler(options));
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

function parseStructuredTest(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && value.schemaVersion === 1
    ? Object.freeze({ schemaVersion: 1 }) : null;
}

function parseStructuredTestResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['schemaVersion', 'status', 'model', 'apiMethod', 'providerApiVersion', 'providerSdkVersion'].includes(key))
    || value.schemaVersion !== 1 || value.status !== 'complete'
    || typeof value.model !== 'string' || !/^gemini-[a-zA-Z0-9._-]{1,120}$/.test(value.model)
    || !WEEKLY_ANALYSIS_API_METHODS.includes(value.apiMethod)
    || value.providerApiVersion !== WEEKLY_ANALYSIS_PROVIDER_API_VERSION
    || value.providerSdkVersion !== WEEKLY_ANALYSIS_PROVIDER_SDK_VERSION) return null;
  return value;
}
