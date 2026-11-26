import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react';
import { Settings, X } from 'lucide-react';
import type { GeminiApiMethod } from './integrations/weeklyAnalysisContract.ts';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export type AiCredentials = { apiKey: string; model: string; apiMethod: GeminiApiMethod };
type Credentials = AiCredentials;
const Context = createContext<{ credentials: Credentials; setCredentials: (value: Credentials) => void } | null>(null);

// Credentials live only in this mounted React tree. Never persist them in the ledger,
// browser storage, URLs, extension payloads, or server configuration.
export function AiSettingsProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<Credentials>({ apiKey: '', model: DEFAULT_MODEL, apiMethod: 'interactions' });
  return <Context.Provider value={{ credentials, setCredentials }}>{children}</Context.Provider>;
}
export function useAiSettings() {
  const settings = useContext(Context);
  if (!settings) throw new Error('AI settings provider missing');
  return settings;
}
export function AiSettingsButton({ label }: { label?: string } = {}) {
  const { credentials, setCredentials } = useAiSettings();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draftKey, setDraftKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [apiMethod, setApiMethod] = useState<GeminiApiMethod>('interactions');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  return <>
    <button className={label ? "secondary-action ai-settings-launch" : "icon-button"} type="button" aria-label={label ?? "AI設定を開く"} onClick={() => {
      setDraftKey(''); setModel(credentials.model); setApiMethod(credentials.apiMethod); setError(''); setStatus(''); dialog.current?.showModal();
    }}><Settings size={20} />{label && <span>{label}</span>}</button>
    <dialog ref={dialog} className="ai-settings-dialog" aria-labelledby={titleId}
      onClick={event => {
        // Native <dialog> retargets backdrop clicks to the dialog itself.
        // A click inside the dialog padding must not discard an unsaved key.
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
      }}
      onClose={() => { setDraftKey(''); setError(''); }}>
      <form onSubmit={event => {
        event.preventDefault();
        const apiKey = draftKey.trim() || credentials.apiKey;
        if (!/^[\x21-\x7e]{1,512}$/.test(apiKey)) { setError('APIキーを入力してください。空白や改行を含むキーは使えません。'); return; }
        if (!/^gemini-[a-zA-Z0-9._-]{1,120}$/.test(model.trim())) { setError('gemini-で始まるモデルIDを入力してください。'); return; }
        setCredentials({ apiKey, model: model.trim(), apiMethod }); setDraftKey(''); setError('');
        setStatus('この画面で使うキーを設定しました。接続はまだ行っていません。');
      }}>
        <div className="ai-settings-dialog-heading"><div><p className="eyebrow">アプリの接続設定</p><h2 id={titleId}>AI設定</h2></div><button className="ai-settings-dialog-close" type="button" aria-label="AI設定を閉じる" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button></div>
        <p>自分のGemini APIキーで文章編集と、本人が明示同意した週次会話の研究用構造化分析を行います。利用料と利用上限は、このキーに紐づくGoogleのプロジェクトに適用されます。</p>
        <p className="ai-key-status">{credentials.apiKey ? 'APIキー：設定済み' : 'APIキー：未設定'}</p>
        <label className="candidate-field"><span>Gemini APIキー</span>
          <input type="password" value={draftKey} onChange={e => { setDraftKey(e.target.value); setStatus(''); }} maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false}
            placeholder={credentials.apiKey ? '変更するときだけ新しいキーを入力' : 'APIキーを貼り付け'} />
        </label>
        <label className="candidate-field"><span>Geminiモデル</span><input value={model} maxLength={127} onChange={e => { setModel(e.target.value); setStatus(''); }} spellCheck={false} /></label>
        <label className="candidate-field"><span>Gemini API方式（文章編集・週次分析）</span><select value={apiMethod} onChange={e => { setApiMethod(e.target.value as GeminiApiMethod); setStatus(''); }}>
          <option value="interactions">Interactions API</option>
          <option value="generate-content">GenerateContent API</option>
        </select></label>
        <p>選択した方式だけを使用します。障害時に別方式へ自動切り替えしません。</p>
        <p>キーはこの画面を開いている間だけ保持します。再読み込みやタブを閉じた後は、もう一度入力してください。</p>
        <p>文章編集または同意済み週次分析の実行時にだけ、キーをこのサイトの中継サーバー経由でGoogleへ渡します。アプリはキーを保存しません。設定するだけでは送信されません。</p>
        {error && <p role="alert">{error}</p>}
        {status && <p role="status">{status}</p>}
        <div className="ai-writing-actions">
          <button className="secondary-action" type="submit">この画面で使う</button>
          <button className="secondary-action" type="button" disabled={!credentials.apiKey && !draftKey} onClick={() => {
            setCredentials({ apiKey: '', model: DEFAULT_MODEL, apiMethod: 'interactions' }); setDraftKey(''); setModel(DEFAULT_MODEL); setApiMethod('interactions'); setError(''); setStatus('APIキーを削除しました。');
          }}>キーを削除する</button>
          <button className="secondary-action" type="button" onClick={() => dialog.current?.close()}>閉じる</button>
        </div>
      </form>
    </dialog>
  </>;
}
