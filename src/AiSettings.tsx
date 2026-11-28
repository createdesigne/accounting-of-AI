import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react';
import { Settings, X } from 'lucide-react';
import type { GeminiApiMethod } from './integrations/weeklyAnalysisContract.ts';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
export type AiAuthMode = 'personal' | 'participant';
export type AiCredentials = { authMode: AiAuthMode; apiKey: string; participantCode: string; model: string; apiMethod: GeminiApiMethod };
type Credentials = AiCredentials;
const Context = createContext<{ credentials: Credentials; setCredentials: (value: Credentials) => void } | null>(null);

// Credentials live only in this mounted React tree. Never persist them in the ledger,
// browser storage, URLs, extension payloads, or server configuration.
export function AiSettingsProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<Credentials>({ authMode: 'personal', apiKey: '', participantCode: '', model: DEFAULT_MODEL, apiMethod: 'interactions' });
  return <Context.Provider value={{ credentials, setCredentials }}>{children}</Context.Provider>;
}
export function useAiSettings() {
  const settings = useContext(Context);
  if (!settings) throw new Error('AI settings provider missing');
  return settings;
}
export function hasWeeklyAnalysisCredential(credentials: AiCredentials) {
  return credentials.authMode === 'participant' ? Boolean(credentials.participantCode) : Boolean(credentials.apiKey);
}
export function hasPersonalGeminiCredential(credentials: AiCredentials) {
  return credentials.authMode === 'personal' && Boolean(credentials.apiKey);
}
export function AiSettingsButton({ label }: { label?: string } = {}) {
  const { credentials, setCredentials } = useAiSettings();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draftKey, setDraftKey] = useState('');
  const [draftParticipantCode, setDraftParticipantCode] = useState('');
  const [authMode, setAuthMode] = useState<AiAuthMode>('personal');
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [apiMethod, setApiMethod] = useState<GeminiApiMethod>('interactions');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  return <>
    <button className={label ? "secondary-action ai-settings-launch" : "icon-button"} type="button" aria-label={label ?? "AI設定を開く"} onClick={() => {
      setDraftKey(''); setDraftParticipantCode(''); setAuthMode(credentials.authMode); setModel(credentials.model); setApiMethod(credentials.apiMethod); setError(''); setStatus(''); dialog.current?.showModal();
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
      onClose={() => { setDraftKey(''); setDraftParticipantCode(''); setError(''); }}>
      <form onSubmit={event => {
        event.preventDefault();
        if (authMode === 'participant') {
          const participantCode = draftParticipantCode.trim() || (credentials.authMode === 'participant' ? credentials.participantCode : '');
          if (!/^[\x21-\x7e]{20,128}$/.test(participantCode)) { setError('研究者から個別に受け取ったアクセスコードを入力してください。'); return; }
          setCredentials({ authMode, apiKey: '', participantCode, model: DEFAULT_MODEL, apiMethod: 'generate-content' });
          setDraftParticipantCode(''); setError(''); setStatus('参加者として接続する準備ができました。分析はまだ行っていません。');
          return;
        }
        const apiKey = draftKey.trim() || (credentials.authMode === 'personal' ? credentials.apiKey : '');
        if (!/^[\x21-\x7e]{1,512}$/.test(apiKey)) { setError('APIキーを入力してください。空白や改行を含むキーは使えません。'); return; }
        if (!/^gemini-[a-zA-Z0-9._-]{1,120}$/.test(model.trim())) { setError('gemini-で始まるモデルIDを入力してください。'); return; }
        setCredentials({ authMode, apiKey, participantCode: '', model: model.trim(), apiMethod }); setDraftKey(''); setError('');
        setStatus('この画面で使うキーを設定しました。接続はまだ行っていません。');
      }}>
        <div className="ai-settings-dialog-heading"><div><p className="eyebrow">アプリの接続設定</p><h2 id={titleId}>AI設定</h2></div><button className="ai-settings-dialog-close" type="button" aria-label="AI設定を閉じる" onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button></div>
        <p>接続方法を選んでください。どちらの場合も、会話本文の送信前に活動ごとの同意を確認します。</p>
        <div className="ai-auth-mode-options" role="radiogroup" aria-label="Geminiの接続方法">
          <label><input type="radio" name="auth-mode" checked={authMode === 'participant'} onChange={() => { setAuthMode('participant'); setError(''); setStatus(''); }} /><strong>研究参加者として利用する</strong><span>研究者から受け取った個別コードを使います。</span></label>
          <label><input type="radio" name="auth-mode" checked={authMode === 'personal'} onChange={() => { setAuthMode('personal'); setError(''); setStatus(''); }} /><strong>自分のGemini APIキーを使う</strong><span>利用料と上限は自分のGoogleプロジェクトに適用されます。</span></label>
        </div>
        {authMode === 'participant' ? <>
          <p className="ai-key-status">{credentials.authMode === 'participant' && credentials.participantCode ? '参加者コード：設定済み' : '参加者コード：未設定'}</p>
          <label className="candidate-field"><span>研究参加者アクセスコード</span><input type="password" value={draftParticipantCode} onChange={e => { setDraftParticipantCode(e.target.value); setStatus(''); }} maxLength={128} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={credentials.authMode === 'participant' && credentials.participantCode ? '変更するときだけ新しいコードを入力' : '個別コードを貼り付け'} /></label>
          <p>コードはこの画面を開いている間だけ保持し、帳簿・研究データ・Chrome拡張機能には保存しません。研究全体と参加者ごとの利用上限があります。</p>
        </> : <>
          <p className="ai-key-status">{credentials.authMode === 'personal' && credentials.apiKey ? 'APIキー：設定済み' : 'APIキー：未設定'}</p>
          <label className="candidate-field"><span>Gemini APIキー</span><input type="password" value={draftKey} onChange={e => { setDraftKey(e.target.value); setStatus(''); }} maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={credentials.authMode === 'personal' && credentials.apiKey ? '変更するときだけ新しいキーを入力' : 'APIキーを貼り付け'} /></label>
          <label className="candidate-field"><span>Geminiモデル</span><input value={model} maxLength={127} onChange={e => { setModel(e.target.value); setStatus(''); }} spellCheck={false} /></label>
          <label className="candidate-field"><span>Gemini API方式（文章編集・週次分析）</span><select value={apiMethod} onChange={e => { setApiMethod(e.target.value as GeminiApiMethod); setStatus(''); }}><option value="interactions">Interactions API</option><option value="generate-content">GenerateContent API</option></select></label>
          <p>選択した方式だけを使用し、障害時に別方式へ自動切り替えしません。</p>
        </>}
        <p>接続情報は再読み込みやタブを閉じると消えます。設定しただけでは外部送信しません。</p>
        {error && <p role="alert">{error}</p>}
        {status && <p role="status">{status}</p>}
        <div className="ai-writing-actions">
          <button className="secondary-action" type="submit">この画面で使う</button>
          <button className="secondary-action" type="button" disabled={!hasWeeklyAnalysisCredential(credentials) && !draftKey && !draftParticipantCode} onClick={() => {
            setCredentials({ authMode: 'personal', apiKey: '', participantCode: '', model: DEFAULT_MODEL, apiMethod: 'interactions' }); setDraftKey(''); setDraftParticipantCode(''); setAuthMode('personal'); setModel(DEFAULT_MODEL); setApiMethod('interactions'); setError(''); setStatus('接続情報を削除しました。');
          }}>接続情報を削除する</button>
          <button className="secondary-action" type="button" onClick={() => dialog.current?.close()}>閉じる</button>
        </div>
      </form>
    </dialog>
  </>;
}
