export type AiWritingRequest = { text: string; instruction?: string };
export type AiWritingResult = { text: string };
const errors = {
  API_KEY_REQUIRED: 'AI設定からGemini APIキーを入力してください。',
  INVALID_CREDENTIALS: 'AI設定のAPIキーとモデルを確認してください。',
  AI_NOT_CONFIGURED: 'AIサーバーはまだ接続されていません。',
  INVALID_INPUT: '送信する文章と依頼内容を確認してください。',
  TOO_LARGE: '文章が長すぎます。短くしてお試しください。',
  FORBIDDEN: 'この画面からのAI接続が許可されていません。',
  BUSY: 'AIへの依頼が混み合っています。少し待ってください。',
  RATE_LIMITED: 'Geminiの利用上限に達しました。時間を置いて確認してください。',
  AUTH_ERROR: 'Geminiのキーまたは利用権限を確認してください。',
  MODEL_UNAVAILABLE: '設定されたGeminiモデルを利用できません。',
  CONTENT_BLOCKED: 'Geminiがこの内容の生成を停止しました。',
  OUTPUT_TRUNCATED: '文章を最後まで生成できませんでした。短い文章でお試しください。',
  INVALID_OUTPUT: '生成した文章を読み取れませんでした。',
  PROVIDER_ERROR: 'AIサービスに接続できませんでした。元の文章は変更されていません。',
  TIMEOUT: 'AIの応答待ちが時間切れになりました。',
  CANCELLED: '生成を中止しました。',
} as const;
type ErrorCode = keyof typeof errors;
export class AiClientError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode) { super(errors[code]); this.name = 'AiClientError'; this.code = code; }
}

// Credentials are request-scoped headers, never URL parameters or ledger fields.
export function createAiClient({ baseUrl = '', apiKey = '', model = 'gemini-3.5-flash-lite', fetchImpl = fetch, timeoutMs = 20000 }: { baseUrl?: string; apiKey?: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('Invalid timeout');
  if (baseUrl) {
    const u = new URL(baseUrl, 'https://local.invalid');
    if (baseUrl !== baseUrl.trim() || baseUrl.includes('\\') || baseUrl.startsWith('//') || u.username || u.password || u.search || u.hash
      || (!baseUrl.startsWith('/') && !/^https?:\/\//.test(baseUrl))
      || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)))) throw new Error('Invalid AI server URL');
  }
  return {
    async rewrite(input: AiWritingRequest, { signal }: { signal?: AbortSignal } = {}): Promise<AiWritingResult> {
      if (!baseUrl) throw new AiClientError('AI_NOT_CONFIGURED');
      if (!apiKey) throw new AiClientError('API_KEY_REQUIRED');
      if (!/^[\x21-\x7e]{1,512}$/.test(apiKey) || !/^gemini-[a-zA-Z0-9._-]{1,120}$/.test(model)) throw new AiClientError('INVALID_CREDENTIALS');
      if (!input || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 6000
        || Object.keys(input).some(k => !['text', 'instruction'].includes(k))
        || (input.instruction !== undefined && (typeof input.instruction !== 'string' || input.instruction.length > 500))) throw new AiClientError('INVALID_INPUT');
      if (signal?.aborted) throw new AiClientError('CANCELLED');
      const controller = new AbortController(); let timedOut = false;
      const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/rewrite`, {
          method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-Gemini-Model': model }, body: JSON.stringify(input), signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new AiClientError(typeof result?.error?.code === 'string' && Object.prototype.hasOwnProperty.call(errors, result.error.code) ? result.error.code : 'PROVIDER_ERROR');
        if (!result || typeof result.text !== 'string' || !result.text.trim() || result.text.length > 8000 || Object.keys(result).some(k => k !== 'text')) throw new AiClientError('INVALID_OUTPUT');
        return { text: result.text };
      } catch (error) {
        if (controller.signal.aborted) throw new AiClientError(timedOut ? 'TIMEOUT' : 'CANCELLED');
        if (error instanceof AiClientError) throw error;
        throw new AiClientError('PROVIDER_ERROR');
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    },
  };
}
