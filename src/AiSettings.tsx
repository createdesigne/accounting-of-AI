import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react';
import { Settings } from 'lucide-react';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
type Credentials = { apiKey: string; model: string };
const Context = createContext<{ credentials: Credentials; setCredentials: (value: Credentials) => void } | null>(null);

// Credentials live only in this mounted React tree. Never persist them in the ledger,
// browser storage, URLs, extension payloads, or server configuration.
export function AiSettingsProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<Credentials>({ apiKey: '', model: DEFAULT_MODEL });
  return <Context.Provider value={{ credentials, setCredentials }}>{children}</Context.Provider>;
}
export function useAiSettings() {
  const settings = useContext(Context);
  if (!settings) throw new Error('AI settings provider missing');
  return settings;
}
export function AiSettingsButton() {
  const { credentials, setCredentials } = useAiSettings();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draftKey, setDraftKey] = useState('');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  return <>
    <button className="icon-button" type="button" aria-label="AI設定を開く" onClick={() => {
      setDraftKey(''); setModel(credentials.model); setError(''); setStatus(''); dialog.current?.showModal();
    }}><Settings size={20} /></button>
    <dialog ref={dialog} className="ai-settings-dialog" aria-labelledby={titleId} onClose={() => { setDraftKey(''); setError(''); }}>
      <form onSubmit={event => {
        event.preventDefault();
        const apiKey = draftKey.trim() || credentials.apiKey;
        if (!/^[\x21-\x7e]{1,512}$/.test(apiKey)) { setError('APIキーを入力してください。空白や改行を含むキーは使えません。'); return; }
        if (!/^gemini-[a-zA-Z0-9._-]{1,120}$/.test(model.trim())) { setError('gemini-で始まるモデルIDを入力してください。'); return; }
        setCredentials({ apiKey, model: model.trim() }); setDraftKey(''); setError('');
        setStatus('この画面で使うキーを設定しました。接続はまだ行っていません。');
      }}>
        <h2 id={titleId}>AI設定</h2>
        <p>自分のGemini APIキーで文章を整えます。利用料と利用上限は、このキーに紐づくGoogleのプロジェクトに適用されます。</p>
        <p className="ai-key-status">{credentials.apiKey ? 'APIキー：設定済み' : 'APIキー：未設定'}</p>
        <label className="candidate-field"><span>Gemini APIキー</span>
          <input type="password" value={draftKey} onChange={e => { setDraftKey(e.target.value); setStatus(''); }} maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false}
            placeholder={credentials.apiKey ? '変更するときだけ新しいキーを入力' : 'APIキーを貼り付け'} />
        </label>
        <label className="candidate-field"><span>Geminiモデル</span><input value={model} maxLength={127} onChange={e => { setModel(e.target.value); setStatus(''); }} spellCheck={false} /></label>
        <p>キーはこの画面を開いている間だけ保持します。再読み込みやタブを閉じた後は、もう一度入力してください。</p>
        <p>文章の送信時に、キーをこのサイトの中継サーバー経由でGoogleへ渡します。アプリはキーを保存しません。設定するだけでは送信されません。</p>
        {error && <p role="alert">{error}</p>}
        {status && <p role="status">{status}</p>}
        <div className="ai-writing-actions">
          <button className="secondary-action" type="submit">この画面で使う</button>
          <button className="secondary-action" type="button" disabled={!credentials.apiKey && !draftKey} onClick={() => {
            setCredentials({ apiKey: '', model: DEFAULT_MODEL }); setDraftKey(''); setModel(DEFAULT_MODEL); setError(''); setStatus('APIキーを削除しました。');
          }}>キーを削除する</button>
          <button className="secondary-action" type="button" onClick={() => dialog.current?.close()}>閉じる</button>
        </div>
      </form>
    </dialog>
  </>;
}
