import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BrowserPool } from '../src/browser';
import { PreviewRuntime, mountComponent } from '../src/runtime';
import { defaultOptions } from '../src/model';

const component = `
import { caption } from './caption';
import './style.css';
class TestCard extends HTMLElement {
  data: { label: string } = { label: 'default' };
  connectedCallback() {
    const root = this.attachShadow({mode:'open'});
    root.innerHTML = '<button>0</button><input aria-label="test"><span></span><slot></slot>';
    root.querySelector('span')!.textContent = this.data.label + caption;
    root.querySelector('button')!.onclick = e => { const b = e.currentTarget as HTMLButtonElement; b.textContent = String(Number(b.textContent) + 1); };
  }
}
customElements.define('test-card', TestCard);`;

test('a broken initial build keeps watching and recovers after the source is fixed', { timeout: 15_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wc-preview-broken-'));
  const entry = path.join(root, 'broken.ts');
  let recovered = false;
  const runtime = new PreviewRuntime(root, entry, error => { if (!error) recovered = true; });
  try {
    await writeFile(entry, 'const broken = ;');
    await runtime.start();
    assert.match(runtime.buildError, /Unexpected/);
    assert.ok(runtime.url);
    await writeFile(entry, 'customElements.define("fixed-card", class extends HTMLElement {});');
    const deadline = Date.now() + 10_000;
    while (!recovered && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.ok(recovered);
    assert.equal(runtime.buildError, undefined);
    assert.match(await (await fetch(new URL('component.js', runtime.url))).text(), /fixed-card/);
  } finally {
    await runtime.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('real Chromium: reuse, Shadow DOM interaction, props, CSS, dependency rebuild, error recovery and cleanup', { timeout: 60_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wc-preview-'));
  const entry = path.join(root, 'component.ts');
  const builds: Array<string | undefined> = [];
  const pool = new BrowserPool();
  const runtime = new PreviewRuntime(root, entry, error => { builds.push(error); });
  try {
    await writeFile(entry, component);
    await writeFile(path.join(root, 'caption.ts'), 'export const caption = " first";');
    await writeFile(path.join(root, 'style.css'), 'test-card { display:block; color:rgb(10, 20, 30); }');
    const [browser, sameBrowser] = await Promise.all([pool.acquire(), pool.acquire()]);
    assert.equal(browser, sameBrowser, 'concurrent requests must share Chromium');
    await runtime.start();
    const context = await browser.newContext();
    const isolated = await browser.newContext();
    const page = await context.newPage();
    await page.goto(runtime.url);
    const options = { ...defaultOptions('test-card'), attributes: { disabled: true, hidden: false }, properties: { data: { label: 'prop' } }, html: '<b>slot content</b>', width: 640, height: 480 };
    assert.deepEqual(await mountComponent(page, options), ['test-card']);
    assert.equal(await page.locator('test-card span').textContent(), 'prop first');
    assert.equal(await page.locator('test-card').getAttribute('disabled'), '');
    assert.equal(await page.locator('test-card').getAttribute('hidden'), null);
    assert.equal(await page.locator('test-card b').textContent(), 'slot content');
    assert.equal(await page.locator('test-card').evaluate(e => getComputedStyle(e).color), 'rgb(10, 20, 30)');
    assert.deepEqual(page.viewportSize(), { width: 640, height: 480 });
    const button = await page.locator('test-card button').boundingBox();
    assert.ok(button);
    await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
    assert.equal(await page.locator('test-card button').textContent(), '1');
    await page.locator('test-card input').click();
    await page.keyboard.insertText('hola');
    assert.equal(await page.locator('test-card input').inputValue(), 'hola');
    assert.ok((await page.screenshot({ type: 'jpeg' })).length > 1000);
    await page.evaluate(() => localStorage.setItem('isolated', 'yes'));
    const other = await isolated.newPage();
    await other.goto(runtime.url);
    assert.equal(await other.evaluate(() => localStorage.getItem('isolated')), null);

    const waitForBuild = async (start: number) => {
      const deadline = Date.now() + 10_000;
      while (builds.length <= start && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
      assert.ok(builds.length > start, 'watcher must rebuild');
    };
    let count = builds.length;
    await writeFile(path.join(root, 'caption.ts'), 'export const caption = " updated";');
    await waitForBuild(count);
    await page.reload();
    await mountComponent(page, options);
    assert.equal(await page.locator('test-card span').textContent(), 'prop updated');
    assert.equal(await pool.acquire(), browser, 'rebuild must reuse the same browser');
    count = builds.length;
    await writeFile(entry, 'export const broken = ;');
    await waitForBuild(count);
    assert.match(builds.at(-1)!, /Unexpected/);
    count = builds.length;
    await writeFile(entry, component);
    await waitForBuild(count);
    assert.equal(builds.at(-1), undefined);
    await page.reload();
    await mountComponent(page, options);
    assert.equal(await page.locator('test-card span').textContent(), 'prop updated');
    await assert.rejects(mountComponent(page, { ...options, tag: 'missing-card' }), /No se ha registrado/);
    const url = runtime.url;
    assert.equal((await fetch(new URL('/component.js', url))).status, 404, 'unguessable route protects bundles');
    await runtime.dispose();
    await assert.rejects(fetch(url));
    await context.close();
    await isolated.close();
    await pool.dispose();
    assert.equal(browser.isConnected(), false);
    await assert.rejects(pool.acquire(), /detenido/);
  } finally {
    await runtime.dispose();
    await pool.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
