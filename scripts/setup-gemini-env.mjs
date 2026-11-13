import { readFile, lstat, mkdir, open, rename, rm, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { dirname, join, relative, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
const errors = {
  INVALID_KEY: 'APIキーは空欄にせず、1行で入力してください。引用符や改行は含めないでください。',
  INVALID_MODEL: 'モデル名は gemini- で始まるモデルIDを入力してください。',
  KEY_REQUIRED: 'キーが未設定です。APIキーを入力してください。',
  TRACKED_ENV: '.envファイルがすでにGit管理されています。キーを保存せず中止しました。先にGitの管理対象から外してください。',
  GIT_CHECK_FAILED: 'Gitの管理状態を確認できないため、キーを保存せず中止しました。Gitの設定やアクセス権を確認してください。',
  UNSAFE_PATH: '設定先が通常のファイルではないため、中止しました。リンク先やフォルダーを確認してください。',
  UNSAFE_FRONTEND: '画面側の.env.localにGeminiキー用の設定があります。キーはserver/.envへ移し、画面側から削除してから実行してください。値は表示しません。',
  DUPLICATE_KEY: '既存のキー設定行が重複しています。ファイル内のGEMINI_API_KEY行を整理するか、キーの更新を選んでください。',
  NO_TERMINAL: 'PowerShellなどの対話式ターミナルで実行してください。キーをコマンドの引数やパイプで渡さないでください。',
  CANCELLED: '設定を中止しました。',
};
class SetupError extends Error { constructor(code) { super(code); this.code = code; } }

async function textFile(path) {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new SetupError('UNSAFE_PATH');
    return await readFile(path, 'utf8');
  } catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}
function values(text, name) {
  return text.split(/\r?\n/).flatMap(line => {
    const match = assignment.exec(line);
    if (!match || match[1] !== name) return [];
    const raw = match[2].trim();
    const quote = raw[0];
    if (quote === '"' || quote === "'") {
      const end = raw.indexOf(quote, 1);
      if (end !== -1) return [raw.slice(1, end)];
    }
    return [raw.split('#')[0].trim()];
  });
}
const lastValue = (text, name) => values(text, name).at(-1) || '';
function update(text, fields) {
  const pending = new Map(Object.entries(fields)); const written = new Set();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).flatMap(line => {
    const match = assignment.exec(line);
    if (!match || !pending.has(match[1])) return [line];
    if (written.has(match[1])) return [];
    written.add(match[1]); return [`${match[1]}=${pending.get(match[1])}`];
  });
  while (lines.at(-1) === '') lines.pop();
  for (const [name, value] of pending) if (!written.has(name)) lines.push(`${name}=${value}`);
  return lines.join('\n') + '\n';
}
async function inspect(projectDir) {
  const root = await realpath(projectDir);
  await mkdir(join(root, 'server'), { recursive: true });
  const serverRoot = await realpath(join(root, 'server'));
  const diff = relative(root, serverRoot);
  if (diff.startsWith('..') || isAbsolute(diff)) throw new SetupError('UNSAFE_PATH');
  const repository = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', windowsHide: true });
  if (repository.status === 0 && repository.stdout.trim() === 'true') {
    for (const file of ['server/.env', '.env.local']) {
      const tracked = spawnSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', file], { encoding: 'utf8', windowsHide: true });
      if (tracked.status === 0) throw new SetupError('TRACKED_ENV');
      if (tracked.status !== 1) throw new SetupError('GIT_CHECK_FAILED');
    }
  } else {
    // ZIP downloads need no Git installation. A real but broken/inaccessible
    // checkout must fail closed, rather than assume the secret is untracked.
    for (let current = root; ; current = dirname(current)) {
      const marker = join(current, '.git');
      try {
        const meta = await lstat(marker);
        if (meta.isFile()) throw new SetupError('GIT_CHECK_FAILED');
        for (const name of ['HEAD', 'config']) {
          try { await lstat(join(marker, name)); throw new SetupError('GIT_CHECK_FAILED'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
      } catch (error) { if (error.code !== 'ENOENT') throw new SetupError('GIT_CHECK_FAILED'); }
      if (dirname(current) === current) break;
    }
  }
  const server = await textFile(join(root, 'server/.env'));
  const frontend = await textFile(join(root, '.env.local'));
  if (['GEMINI_API_KEY', 'VITE_GEMINI_API_KEY'].some(name => values(frontend, name).length > 0)) throw new SetupError('UNSAFE_FRONTEND');
  const ignore = await textFile(join(root, '.gitignore'));
  return { root, server, frontend, ignore };
}

// Only the user-run CLI reads real settings. Tests call this with isolated temp directories.
// Existing key values are never returned, printed, or put into backup files.
export async function configureGeminiEnv({ projectDir = projectDirectory, apiKey, model, enabled } = {}) {
  const old = await inspect(projectDir);
  if (apiKey !== undefined && (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n\0"'\\]/.test(apiKey) || apiKey.length > 4096)) throw new SetupError('INVALID_KEY');
  if (apiKey === undefined && values(old.server, 'GEMINI_API_KEY').length > 1) throw new SetupError('DUPLICATE_KEY');
  if (apiKey === undefined && !lastValue(old.server, 'GEMINI_API_KEY')) throw new SetupError('KEY_REQUIRED');
  const selectedModel = model || lastValue(old.server, 'GEMINI_MODEL') || DEFAULT_MODEL;
  if (typeof selectedModel !== 'string' || !/^gemini-[A-Za-z0-9._-]{1,120}$/.test(selectedModel)) throw new SetupError('INVALID_MODEL');
  if (enabled !== undefined && typeof enabled !== 'boolean') throw new SetupError('INVALID_MODEL');
  const aiEnabled = enabled ?? lastValue(old.server, 'AI_ENABLED') === 'true';
  const fields = { AI_ENABLED: String(aiEnabled), AI_PROVIDER: 'gemini', GEMINI_MODEL: selectedModel };
  if (apiKey !== undefined) fields.GEMINI_API_KEY = JSON.stringify(apiKey.trim());
  if (!lastValue(old.server, 'AI_SERVER_PORT')) fields.AI_SERVER_PORT = '8787';
  if (!lastValue(old.server, 'AI_ALLOWED_ORIGINS')) fields.AI_ALLOWED_ORIGINS = 'http://127.0.0.1:5173,http://localhost:5173';
  const server = update(old.server, fields);
  // The frontend receives an address only. Do not copy server settings into it.
  const frontend = lastValue(old.frontend, 'VITE_AI_SERVER_URL') ? old.frontend : update(old.frontend, { VITE_AI_SERVER_URL: '/api/ai' });
  const patterns = ['/server/.env', '/.env.local', '/server/.env.setup-*.tmp', '/.env.local.setup-*.tmp'];
  const ignore = old.ignore.split(/\r?\n/).filter(line => !patterns.includes(line.trim())).join('\n').replace(/\s*$/, '')
    + '\n' + patterns.join('\n') + '\n';
  const changes = [
    { path: join(old.root, '.gitignore'), content: ignore, mode: 0o644 },
    { path: join(old.root, 'server/.env'), content: server, mode: 0o600 },
    { path: join(old.root, '.env.local'), content: frontend, mode: 0o600 },
  ];
  // Install ignore rules before creating any temporary file containing a key.
  for (const change of changes) {
    const temp = `${change.path}.setup-${randomUUID()}.tmp`;
    try {
      const handle = await open(temp, 'wx', change.mode);
      try { await handle.writeFile(change.content, 'utf8'); } finally { await handle.close(); }
      await rename(temp, change.path);
    } finally { await rm(temp, { force: true }); }
  }
  return { files: ['server/.env', '.env.local', '.gitignore'], keyUpdated: apiKey !== undefined, aiEnabled };
}

async function question(prompt, hidden = false) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new SetupError('NO_TERMINAL');
  const silent = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const rl = createInterface({ input: process.stdin, output: hidden ? silent : process.stdout, terminal: true, historySize: 0 });
  const controller = new AbortController();
  rl.once('SIGINT', () => controller.abort());
  try {
    if (hidden) process.stdout.write(prompt);
    return await rl.question(hidden ? '' : prompt, { signal: controller.signal });
  } catch { throw new SetupError('CANCELLED'); }
  finally { rl.close(); if (hidden) { silent.destroy(); process.stdout.write('\n'); } }
}

export async function runSetup({ projectDir = projectDirectory } = {}) {
  const old = await inspect(projectDir);
  console.log('Geminiの.env設定を作成します。Googleへの接続や文章送信は行いません。');
  console.log('キーは非表示で入力し、PC内のserver/.envへ平文で保存します。キーをGitやチャットへ貼らないでください。');
  const hasKey = !!lastValue(old.server, 'GEMINI_API_KEY');
  let replace = !hasKey;
  if (hasKey) replace = /^(y|yes|はい)$/i.test((await question('既存のAPIキーを更新しますか？ [y/N]: ')).trim());
  const model = (await question(`モデルID（キーの入力欄ではありません。空欄は既存設定を維持、新規は${DEFAULT_MODEL}）: `)).trim() || undefined;
  const choice = (await question('画面での送信を有効にしますか？API利用料が発生する場合があります。[y=有効/n=無効/空欄=既存を維持、新規は無効]: ')).trim();
  if (choice && !/^(y|yes|はい|n|no|いいえ)$/i.test(choice)) throw new SetupError('CANCELLED');
  const enabled = choice ? /^(y|yes|はい)$/i.test(choice) : undefined;
  // Ask for the key last, so no later visible prompt can accidentally echo it.
  const apiKey = replace ? await question('GEMINI_API_KEYを貼り付けてEnter（入力は表示されません）: ', true) : undefined;
  const result = await configureGeminiEnv({ projectDir, apiKey, model, enabled });
  console.log('保存しました：server/.env、.env.local、.gitignore（キーの値は表示しません）。');
  console.log(result.aiEnabled ? 'ファイル内のAI送信設定は有効です。画面で送信ボタンを押した場合にだけGeminiを呼び出します。' : 'ファイル内のAI送信設定は無効です。設定だけを保存しました。');
  console.log('次に、サーバーを pnpm ai:server、別のターミナルで画面を pnpm dev:ai と起動／再起動してください。');
  console.log('クラウド環境の変数を設定済みの場合、その値が.envより優先されます。');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes('--help')) {
    console.log('node scripts/setup-gemini-env.mjs\nAPIキーは実行後の非表示入力欄に入力します。キーを引数に渡さないでください。');
  } else if (process.argv.length > 2) {
    console.error('引数は使用しません。APIキーは実行後の非表示入力欄で設定してください。'); process.exitCode = 1;
  } else {
    runSetup().catch(error => {
      console.error(errors[error.code] || '設定の保存に失敗しました。ファイルのアクセス権を確認してください。一部保存済みの場合があります。');
      process.exitCode = 1;
    });
  }
}
