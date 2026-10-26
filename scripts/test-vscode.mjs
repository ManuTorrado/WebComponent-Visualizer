import { _electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const executablePath = process.env.VSCODE_EXECUTABLE;
if (!executablePath) throw new Error('Set VSCODE_EXECUTABLE to the VS Code Electron binary (for example /usr/share/code/code).');
const profile = await mkdtemp(path.join(os.tmpdir(), 'wc-vscode-ui-'));
const env = { ...process.env, WC_VISUALIZER_TEST_DWELL: '20000' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await _electron.launch({
    executablePath, env, timeout: 30_000,
    args: ['--no-sandbox', '--disable-gpu', '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes',
      `--user-data-dir=${profile}/data`, `--extensions-dir=${profile}/extensions`,
      `--extensionDevelopmentPath=${process.cwd()}`, `--extensionTestsPath=${process.cwd()}/test/vscode-smoke.cjs`, path.join(process.cwd(), 'examples')]
  });
  const exited = new Promise(resolve => app.process().once('exit', code => resolve(code)));
  const window = await app.firstWindow();
  let preview;
  const deadline = Date.now() + 20_000;
  while (!preview && Date.now() < deadline) {
    for (const frame of window.frames()) {
      if (await frame.locator('#screen').count().catch(() => 0)) { preview = frame; break; }
    }
    if (!preview) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(preview, 'VS Code must load the preview webview');
  await preview.locator('#screen').waitFor({ state: 'visible', timeout: 10_000 });
  await preview.waitForFunction(() => document.getElementById('screen').naturalWidth === 900 && document.getElementById('status').textContent === 'Conectado', undefined, { timeout: 10_000 });
  assert.equal(await preview.locator('#error').isVisible(), false);
  assert.equal(await preview.locator('#status').textContent(), 'Conectado');
  await preview.locator('summary').click();
  await preview.locator('#attributes').fill('{"label":"Vista verificada"}');
  const before = await preview.locator('#screen').getAttribute('src');
  await preview.locator('button[type=submit]').click();
  await preview.waitForFunction(old => document.getElementById('screen').getAttribute('src') !== old, before);
  assert.equal(await preview.locator('#error').isVisible(), false);
  await preview.locator('summary').click();
  if (process.env.WC_VISUALIZER_SCREENSHOT) await window.screenshot({ path: process.env.WC_VISUALIZER_SCREENSHOT });
  assert.equal(await exited, 0, 'VS Code extension-host smoke test must pass');
  console.log('VS Code UI passed: webview ready, real browser frame, attributes update and clean shutdown.');
} finally {
  await app?.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
}
