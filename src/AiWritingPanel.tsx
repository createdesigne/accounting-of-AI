import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { AiClientError, createAiClient } from './aiClient';

type FieldKey = 'topic' | 'aiAdded' | 'selfDecision';
type WritingField = { key: FieldKey; label: string; value: string };

export function AiWritingPanel({ baseUrl, fields, onApply }: {
  baseUrl: string; fields: readonly WritingField[]; onApply: (key: FieldKey, text: string) => void;
}) {
  const [key, setKey] = useState<FieldKey>('aiAdded');
  const field = fields.find(item => item.key === key)!;
  const [instruction, setInstruction] = useState('意味や事実を変えず、読みやすく簡潔な文章に整える');
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<{ key: FieldKey; source: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const requestId = useRef(0);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    requestId.current++;
    pending.current?.abort();
    setBusy(false); setProposal(null); setError('');
  }, [key, field.value, instruction]);
  useEffect(() => () => { requestId.current++; pending.current?.abort(); }, []);

  async function generate() {
    const id = ++requestId.current;
    const source = field.value;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setProposal(null); setError(''); setStatus('');
    try {
      const result = await createAiClient({ baseUrl }).rewrite({ text: source, instruction }, { signal: controller.signal });
      if (requestId.current === id) setProposal({ key, source, text: result.text });
    } catch (err) {
      if (requestId.current !== id) return;
      if (err instanceof AiClientError && err.code === 'CANCELLED') setStatus('生成を中止しました。元の文章は変更していません。');
      else setError(err instanceof AiClientError ? err.message : 'AIの接続設定を確認してください。元の文章は変更していません。');
    } finally { if (requestId.current === id) setBusy(false); }
  }

  return <section className="ai-writing-panel" aria-labelledby="ai-writing-heading" aria-busy={busy}>
    <h3 id="ai-writing-heading"><Sparkles size={18} aria-hidden="true" />Geminiで文章を整える</h3>
    <p>選んだ項目の文章と編集の依頼だけをGoogleのGeminiに送信します。生成結果を確認してから反映できます。</p>
    <label className="candidate-field"><span>整える項目</span>
      <select value={key} onChange={e => { setKey(e.target.value as FieldKey); setStatus(''); }}>
        {fields.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
    </label>
    <label className="candidate-field"><span>文章の整え方</span>
      <textarea value={instruction} maxLength={500} rows={2} onChange={e => { setInstruction(e.target.value); setStatus(''); }} />
    </label>
    <div className="ai-writing-actions">
      <button className="secondary-action" type="button" disabled={busy || !field.value.trim() || field.value.length > 6000} onClick={generate}>Geminiに送信して文章を整える</button>
      {busy && <button className="secondary-action" type="button" onClick={() => pending.current?.abort()}>生成を中止する</button>}
    </div>
    {busy && <p role="status">Geminiの応答を待っています…</p>}
    {field.value.length > 6000 && <p role="alert">選んだ文章を6000文字以内にしてください。</p>}
    {error && <p role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    {proposal && <div className="ai-writing-proposal">
      <label className="candidate-field"><span>生成した文章</span><textarea aria-label="生成した文章" readOnly rows={5} value={proposal.text} /></label>
      <p>事実や意図が変わっていないか確認してください。反映しても、帳簿にはまだ保存されません。</p>
      <div className="ai-writing-actions">
        <button className="secondary-action" type="button" onClick={() => {
          if (fields.find(item => item.key === proposal.key)?.value !== proposal.source) { setProposal(null); return; }
          onApply(proposal.key, proposal.text); setProposal(null); setStatus('候補に反映しました。内容を確認してから発行してください。');
        }}>この文章を候補に反映する</button>
        <button className="secondary-action" type="button" onClick={() => { setProposal(null); setStatus('生成した文章を破棄しました。'); }}>生成した文章を破棄する</button>
      </div>
    </div>}
  </section>;
}
