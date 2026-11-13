export const TEXT_LIMIT = 6000;
export const INSTRUCTION_LIMIT = 500;
export const RESULT_LIMIT = 8000;

export function parseInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(k => !['text', 'instruction'].includes(k))
    || typeof value.text !== 'string' || !value.text.trim() || value.text.length > TEXT_LIMIT
    || (value.instruction !== undefined && (typeof value.instruction !== 'string' || value.instruction.length > INSTRUCTION_LIMIT))) return null;
  return value.instruction === undefined ? { text: value.text } : { text: value.text, instruction: value.instruction };
}

export function parseResult(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(k => k === 'text') && typeof value.text === 'string'
    && value.text.trim() && value.text.length <= RESULT_LIMIT ? { text: value.text } : null;
}

export class AiError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'AiError'; }
}
