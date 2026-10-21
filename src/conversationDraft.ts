export type RawConversation = {
  aiService?: string;
  url?: string;
  capturedAt?: string;
  conversationTitle?: string;
  messages?: { role?: string; text?: string }[];
};

export function parseDraftConversation(draft: string): RawConversation | null {
  const candidates = [draft];
  try { candidates.push(decodeURIComponent(draft)); } catch { /* Legacy encoded JSON. */ }
  try {
    const base64 = draft.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    candidates.push(new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0))));
  } catch { /* The payload may be plain JSON instead. */ }
  for (const candidate of new Set(candidates)) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (isRawConversation(value)) return value;
    } catch { /* Try the remaining legacy representations. */ }
  }
  return null;
}

function isRawConversation(value: unknown): value is RawConversation {
  if (!value || typeof value !== "object") return false;
  const raw = value as RawConversation;
  return [raw.aiService, raw.url, raw.capturedAt, raw.conversationTitle].every(v => v === undefined || typeof v === "string")
    && Array.isArray(raw.messages) && raw.messages.length > 0
    && raw.messages.every(message => message !== null && typeof message === "object"
      && typeof message.text === "string" && (message.role === undefined || typeof message.role === "string"))
    && raw.messages.some(message => message.text!.trim().length > 0);
}
