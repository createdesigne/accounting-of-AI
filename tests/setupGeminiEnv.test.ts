import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { configureGeminiEnv } from '../scripts/setup-gemini-env.mjs';

const key = 'test-only-key-not-a-real-google-key';
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'gemini-env-setup-'));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}
const git = (root, ...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });

test('env setup creates server-only credentials and a public URL without exposing a key to frontend files', async () => fixture(async root => {
  const result = await configureGeminiEnv({ projectDir: root, apiKey: key, enabled: true });
  assert.deepEqual(result, { files: ['server/.env', '.env.local', '.gitignore'], keyUpdated: true, aiEnabled: true });
  assert.ok(!JSON.stringify(result).includes(key));
  const server = await readFile(join(root, 'server/.env'), 'utf8');
  assert.ok(server.includes(`GEMINI_API_KEY="${key}"`));
  assert.ok(server.includes('AI_ENABLED=true'));
  assert.equal(await readFile(join(root, '.env.local'), 'utf8'), 'VITE_AI_SERVER_URL=/api/ai\n');
  assert.ok(!(await readFile(join(root, '.gitignore'), 'utf8')).includes(key));
  assert.deepEqual((await readdir(join(root, 'server'))).sort(), ['.env'], 'no secret backup/temp files');
  if (process.platform !== 'win32') assert.equal((await stat(join(root, 'server/.env'))).mode & 0o777, 0o600);
  const hash = createHash('sha256').update(key).digest('hex');
  const check = spawnSync(process.execPath, ['--env-file=' + join(root, 'server/.env'), '-e', `if(require('node:crypto').createHash('sha256').update(process.env.GEMINI_API_KEY||'').digest('hex')!=='${hash}' || process.env.AI_ENABLED!=="true")process.exit(1)`], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(check.status, 0, check.stderr);
  assert.equal(check.stdout, '');
}));

test('env setup preserves an existing key, custom values/comments/URLs and is idempotent', async () => fixture(async root => {
  await mkdir(join(root, 'server'));
  const initial = '# private settings\r\nGEMINI_API_KEY="old-test-key" # keep this line\r\nGEMINI_MODEL="gemini-custom" # existing model\r\nAI_ENABLED=true\r\nAI_SERVER_PORT=9000\r\nAI_ALLOWED_ORIGINS=https://approved.example\r\nCUSTOM_VALUE=keep-me\r\n';
  await writeFile(join(root, 'server/.env'), initial);
  await writeFile(join(root, '.env.local'), '# custom\nVITE_AI_SERVER_URL=https://approved.example/api/ai\nVITE_OTHER=keep\n');
  await writeFile(join(root, '.gitignore'), 'node_modules/\n# keep custom ignores\ncustom/\n');
  const result = await configureGeminiEnv({ projectDir: root });
  assert.equal(result.keyUpdated, false); assert.equal(result.aiEnabled, true);
  const server = await readFile(join(root, 'server/.env'), 'utf8');
  for (const value of ['GEMINI_API_KEY="old-test-key" # keep this line', 'CUSTOM_VALUE=keep-me', 'AI_SERVER_PORT=9000', 'AI_ALLOWED_ORIGINS=https://approved.example', 'GEMINI_MODEL=gemini-custom']) assert.ok(server.includes(value));
  assert.equal(await readFile(join(root, '.env.local'), 'utf8'), '# custom\nVITE_AI_SERVER_URL=https://approved.example/api/ai\nVITE_OTHER=keep\n');
  const before = await Promise.all(['server/.env', '.env.local', '.gitignore'].map(p => readFile(join(root, p), 'utf8')));
  await configureGeminiEnv({ projectDir: root });
  assert.deepEqual(await Promise.all(['server/.env', '.env.local', '.gitignore'].map(p => readFile(join(root, p), 'utf8'))), before);
}));

test('env setup replaces a key only when explicitly supplied and can disable generation', async () => fixture(async root => {
  await mkdir(join(root, 'server'));
  await writeFile(join(root, 'server/.env'), 'GEMINI_API_KEY="old-test-key"\nGEMINI_API_KEY=duplicate-test-key\nAI_ENABLED=true\n');
  await assert.rejects(configureGeminiEnv({ projectDir: root }), e => e.code === 'DUPLICATE_KEY');
  await configureGeminiEnv({ projectDir: root, apiKey: key, model: 'gemini-approved', enabled: false });
  const server = await readFile(join(root, 'server/.env'), 'utf8');
  assert.equal(server.match(/^GEMINI_API_KEY=/gm)?.length, 1);
  assert.ok(!server.includes('old-test-key') && !server.includes('duplicate-test-key'));
  assert.ok(server.includes('AI_ENABLED=false'));
}));

test('invalid or missing values do not replace existing env/ignore files', async () => fixture(async root => {
  await mkdir(join(root, 'server'));
  await writeFile(join(root, 'server/.env'), '# unchanged\n');
  for (const options of [{}, { apiKey: '' }, { apiKey: 'invalid\nkey' }, { apiKey: 'invalid"key' }, { apiKey: "invalid'key" }, { apiKey: key, model: '../bad' }]) {
    await assert.rejects(configureGeminiEnv({ projectDir: root, ...options }));
    assert.equal(await readFile(join(root, 'server/.env'), 'utf8'), '# unchanged\n');
    assert.ok(!(await readdir(root)).includes('.env.local'));
    assert.ok(!(await readdir(root)).includes('.gitignore'));
  }
}));

test('Git ignores both final and temporary secret files even after an old unignore rule', async () => fixture(async root => {
  assert.equal(git(root, 'init', '-q').status, 0);
  await writeFile(join(root, '.gitignore'), '/server/.env\n!/server/.env\n');
  await configureGeminiEnv({ projectDir: root, apiKey: key });
  for (const path of ['server/.env', '.env.local', 'server/.env.setup-fake.tmp', '.env.local.setup-fake.tmp']) assert.equal(git(root, 'check-ignore', '-q', '--', path).status, 0, path);
  assert.ok(!git(root, 'status', '--porcelain').stdout.includes('server/.env'));
}));

test('already tracked env files are rejected before writing credentials', async () => fixture(async root => {
  assert.equal(git(root, 'init', '-q').status, 0);
  await mkdir(join(root, 'server'));
  await writeFile(join(root, 'server/.env'), '# tracked placeholder\n');
  assert.equal(git(root, 'add', 'server/.env').status, 0);
  await assert.rejects(configureGeminiEnv({ projectDir: root, apiKey: key }), e => e.code === 'TRACKED_ENV');
  assert.equal(await readFile(join(root, 'server/.env'), 'utf8'), '# tracked placeholder\n');
}));

test('a broken Git checkout cannot bypass the tracked-secret check', async () => fixture(async root => {
  assert.equal(git(root, 'init', '-q').status, 0);
  await writeFile(join(root, '.git/config'), '[broken syntax\n');
  await assert.rejects(configureGeminiEnv({ projectDir: root, apiKey: key }), e => e.code === 'GIT_CHECK_FAILED');
  assert.deepEqual(await readdir(join(root, 'server')), []);
}));

test('a key mistakenly placed in the frontend file is rejected without printing or copying it', async () => fixture(async root => {
  await writeFile(join(root, '.env.local'), `VITE_GEMINI_API_KEY=${key}\n`);
  await assert.rejects(configureGeminiEnv({ projectDir: root, apiKey: key }), e => e.code === 'UNSAFE_FRONTEND' && !e.message.includes(key));
  assert.equal(await readFile(join(root, '.env.local'), 'utf8'), `VITE_GEMINI_API_KEY=${key}\n`);
  assert.deepEqual(await readdir(join(root, 'server')), []);
}));

test('symlinked configuration files are not followed or overwritten', { skip: process.platform === 'win32' }, async () => fixture(async root => {
  await mkdir(join(root, 'server'));
  await writeFile(join(root, 'outside-test-file'), 'unchanged');
  await symlink(join(root, 'outside-test-file'), join(root, 'server/.env'));
  await assert.rejects(configureGeminiEnv({ projectDir: root, apiKey: key }), e => e.code === 'UNSAFE_PATH');
  assert.equal(await readFile(join(root, 'outside-test-file'), 'utf8'), 'unchanged');
}));

test('CLI help and rejected arguments never echo a supplied value', () => {
  const script = resolve('scripts/setup-gemini-env.mjs');
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0); assert.ok(!help.stdout.includes(key));
  const bad = spawnSync(process.execPath, [script, '--api-key', key], { encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.ok(!(bad.stdout + bad.stderr).includes(key));
});

test('non-interactive execution refuses piped input without creating secret files', async () => fixture(async root => {
  const program = `import {runSetup} from ${JSON.stringify(new URL('../scripts/setup-gemini-env.mjs', import.meta.url).href)}; try { await runSetup({projectDir:${JSON.stringify(root)}}); process.exitCode=2; } catch(e) { if(e.code!=='NO_TERMINAL')process.exitCode=3; }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', input: key });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!(result.stdout + result.stderr).includes(key));
  assert.deepEqual(await readdir(join(root, 'server')), []);
}));

test('interactive terminal input masks the key and writes usable env files', { skip: process.platform === 'win32' }, async () => fixture(async root => {
  const script = resolve('scripts/setup-gemini-env.mjs');
  const program = `import {runSetup} from ${JSON.stringify(new URL('../scripts/setup-gemini-env.mjs', import.meta.url).href)}; await runSetup({projectDir:${JSON.stringify(root)}});`;
  const python = `
import os,pty,subprocess,select,time,sys
master,slave=pty.openpty()
p=subprocess.Popen([sys.argv[1],'--input-type=module','-e',sys.argv[2]],stdin=slave,stdout=slave,stderr=slave,close_fds=True)
os.close(slave)
output=b''
def until(marker):
 global output
 deadline=time.monotonic()+8
 while marker not in output:
  if time.monotonic()>deadline:raise RuntimeError('terminal prompt timeout')
  if select.select([master],[],[],0.2)[0]:
   try: data=os.read(master,4096)
   except OSError: break
   if not data:break
   output+=data
 if marker not in output:raise RuntimeError('terminal prompt missing')
try:
 until('モデルID'.encode());os.write(master,b'\\r')
 until('画面での送信'.encode());os.write(master,b'y\\r')
 until('貼り付けてEnter'.encode());os.write(master,b'test-only-key-not-a-real-google-key\\r')
 until('保存しました'.encode())
 p.wait(timeout=8)
 assert p.returncode==0
 assert b'test-only-key-not-a-real-google-key' not in output
 print('PASS: interactive secret input did not echo the key')
finally:
 if p.poll() is None:p.kill();p.wait()
 os.close(master)
`;
  const result = spawnSync('python3', ['-c', python, process.execPath, program], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.stdout.includes(key));
  assert.ok((await readFile(join(root, 'server/.env'), 'utf8')).includes(`GEMINI_API_KEY="${key}"`));
}));
