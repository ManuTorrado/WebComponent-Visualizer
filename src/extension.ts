import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { BrowserPool } from './browser';
import { defaultOptions, discoverTags, validateOptions, type PreviewOptions } from './model';
import { PreviewRuntime, mountComponent } from './runtime';
import type { BrowserContext, Page } from 'playwright';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

let pool: BrowserPool | undefined;
const panels = new Set<PreviewPanel>();
let output: vscode.OutputChannel;
let installing: Promise<void> | undefined;

function browserPool(): BrowserPool {
  return pool ??= new BrowserPool(vscode.workspace.getConfiguration('wcVisualizer').get<string>('executablePath'));
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Web Component Visualizer');
  context.subscriptions.push(output);
  context.subscriptions.push(vscode.commands.registerCommand('wcVisualizer.preview', async (uri?: vscode.Uri) => {
    try {
      if (!vscode.workspace.isTrusted) throw new Error('Confía en el workspace para ejecutar sus componentes.');
      uri ??= vscode.window.activeTextEditor?.document.uri;
      if (!uri || uri.scheme !== 'file' || !/\.(m?js|ts|jsx|tsx)$/.test(uri.fsPath)) throw new Error('Abre un archivo JavaScript o TypeScript.');
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      if (!folder) throw new Error('Abre la carpeta del proyecto en VS Code primero.');
      const document = await vscode.workspace.openTextDocument(uri);
      if (document.isDirty && !(await document.save())) return;
      const tags = discoverTags(document.getText());
      const tag = tags.length === 1 ? tags[0] : tags.length > 1
        ? await vscode.window.showQuickPick(tags, { title: 'Componente a previsualizar' })
        : await vscode.window.showInputBox({ title: 'Nombre del custom element', prompt: 'El archivo debe registrar esta etiqueta al importarse.', placeHolder: 'my-component' });
      if (!tag) return;
      const options = validateOptions(defaultOptions(tag));
      const preview = new PreviewPanel(context, folder.uri.fsPath, uri, options);
      panels.add(preview);
    } catch (error) { void vscode.window.showErrorMessage(String(error)); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('wcVisualizer.prewarm', async () => {
    if (!vscode.workspace.isTrusted) return;
    try { await browserPool().acquire(); void vscode.window.showInformationMessage('Chromium listo para reutilizar.'); }
    catch (error) { await browserError(error); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('wcVisualizer.installBrowser', () => {
    if (!vscode.workspace.isTrusted) return;
    return installing ??= installBrowser().finally(() => { installing = undefined; });
  }));
  context.subscriptions.push(vscode.commands.registerCommand('wcVisualizer.stop', async () => {
    const current = pool; pool = undefined;
    await Promise.all([...panels].map(panel => panel.close()));
    await current?.dispose();
  }));
  const prewarm = () => {
    if (vscode.workspace.isTrusted && vscode.workspace.workspaceFolders?.length && vscode.workspace.getConfiguration('wcVisualizer').get('prewarm', true)) {
      void browserPool().acquire().catch(error => output.appendLine(`Prewarm: ${String(error)}\nEjecuta “Web Components: Install Chromium” o configura wcVisualizer.executablePath.`));
    }
  };
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(prewarm));
  prewarm();
}

async function browserError(error: unknown): Promise<void> {
  output.appendLine(String(error));
  const action = await vscode.window.showErrorMessage('No se pudo abrir Chromium. Instálalo o configura wcVisualizer.executablePath. Los detalles están en Output.', 'Instalar Chromium', 'Ver detalles');
  if (action === 'Instalar Chromium') await vscode.commands.executeCommand('wcVisualizer.installBrowser');
  if (action === 'Ver detalles') output.show();
}

async function installBrowser(): Promise<void> {
  output.show(true);
  output.appendLine('Instalando Chromium con Playwright…');
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Descargando Chromium para Web Component Visualizer' }, () => new Promise<void>((resolve, reject) => {
      const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
      const child = spawn(process.execPath, [cli, 'install', 'chromium'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
      child.stdout.on('data', data => output.append(String(data)));
      child.stderr.on('data', data => output.append(String(data)));
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Playwright terminó con código ${code}. Revisa Output.`)));
    }));
    void vscode.window.showInformationMessage('Chromium instalado. Abre de nuevo la previsualización.');
  } catch (error) { void vscode.window.showErrorMessage(String(error)); }
}

class PreviewPanel {
  private readonly panel: vscode.WebviewPanel;
  private runtime?: PreviewRuntime;
  private context?: BrowserContext;
  private page?: Page;
  private closed = false;
  private initialized = false;
  private timer?: ReturnType<typeof setTimeout>;
  private disposing?: Promise<void>;
  private queue = Promise.resolve();
  private lastFrame?: string;
  private readyForFrames = false;
  private options: PreviewOptions;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(extension: vscode.ExtensionContext, private readonly root: string, private readonly uri: vscode.Uri, options: PreviewOptions) {
    this.options = options;
    this.panel = vscode.window.createWebviewPanel('wcVisualizer', `<${options.tag}>`, vscode.ViewColumn.Beside, {
      enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extension.extensionUri, 'media')]
    });
    const webview = this.panel.webview;
    const nonce = randomBytes(24).toString('hex');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'media', 'preview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(extension.extensionUri, 'media', 'preview.css'));
    webview.html = `<!doctype html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
      <link rel="stylesheet" href="${style}"></head><body>
      <header><div><span class="badge">WC</span><strong>Component Preview</strong></div><span id="status" role="status">Iniciando…</span><button id="reload" title="Recargar el componente">↻ Recargar</button></header>
      <form id="controls"><div class="row"><label>Componente<input id="tag" list="tags" required placeholder="my-component"><datalist id="tags"></datalist></label>
      <label>Ancho<input id="width" type="number" min="100" max="2400"></label><label>Alto<input id="height" type="number" min="100" max="2400"></label><label>Fondo<input id="background" type="color"></label><button type="submit">Aplicar</button></div>
      <details><summary>Atributos, propiedades y slots</summary><div class="editors"><label>Atributos · JSON<textarea id="attributes" spellcheck="false" rows="5">{}</textarea></label><label>Propiedades · JSON<textarea id="properties" spellcheck="false" rows="5">{}</textarea></label><label>Contenido / slots · HTML<textarea id="html" spellcheck="false" rows="5" placeholder="&lt;span slot='label'&gt;Hola&lt;/span&gt;"></textarea></label></div></details></form>
      <div id="error" role="alert" hidden></div><div id="stage"><img id="screen" tabindex="0" alt="Previsualización interactiva del Web Component" draggable="false" hidden><div id="placeholder">Preparando el navegador…</div></div>
      <footer><span id="dimensions"></span><span>Clic para interactuar · Tab para navegar · Guardar para recargar</span></footer>
      <script nonce="${nonce}" src="${script}"></script></body></html>`;
    this.disposables.push(webview.onDidReceiveMessage(message => {
      if (message?.type === 'ready' && !this.initialized) {
        this.initialized = true;
        this.post({ type: 'init', options, file: uri.fsPath });
        this.enqueue(() => this.start());
      } else if (message?.type === 'apply') {
        this.enqueue(async () => {
          const next = validateOptions(message.options);
          this.options = next;
          await this.mount();
        });
      } else if (message?.type === 'reload') this.enqueue(() => this.reload());
      else if (message?.type === 'input') this.enqueue(() => this.input(message));
    }));
    this.disposables.push(this.panel.onDidDispose(() => { void this.dispose(); }));
    this.disposables.push(this.panel.onDidChangeViewState(() => { this.lastFrame = undefined; }));
  }

  private post(message: unknown): void { if (!this.closed) void this.panel.webview.postMessage(message); }
  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(async () => { if (!this.closed) await task(); }).catch(error => {
      if (!this.closed) { this.post({ type: 'error', text: String(error) }); output.appendLine(String(error)); }
    });
  }

  private async start(): Promise<void> {
    const browser = await browserPool().acquire().catch(async error => { await browserError(error); throw error; });
    if (this.closed) return;
    this.context = await browser.newContext({ viewport: { width: this.options.width, height: this.options.height }, deviceScaleFactor: 1, acceptDownloads: false });
    if (this.closed) return;
    this.page = await this.context.newPage();
    this.page.on('pageerror', error => this.post({ type: 'error', text: error.message }));
    this.page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) output.appendLine(`[${this.uri.fsPath}] ${msg.type()}: ${msg.text()}`); });
    this.page.on('dialog', dialog => { output.appendLine(`Diálogo: ${dialog.message()}`); void dialog.dismiss(); });
    this.page.on('popup', popup => { void popup.close(); });
    this.page.on('crash', () => this.post({ type: 'error', text: 'Chromium dejó de responder. Cierra y vuelve a abrir esta vista.' }));
    this.runtime = new PreviewRuntime(this.root, this.uri.fsPath, error => {
      if (error) { this.post({ type: 'error', text: error }); output.appendLine(error); }
      else if (this.runtime?.url) this.enqueue(() => this.reload());
    });
    await this.runtime.start();
    this.capture();
    await this.reload();
  }

  private async reload(): Promise<void> {
    if (!this.page || !this.runtime?.url) return;
    if (this.runtime.buildError) throw new Error(this.runtime.buildError);
    this.readyForFrames = false;
    this.post({ type: 'status', text: 'Recargando…' });
    await this.page.goto(this.runtime.url, { waitUntil: 'load', timeout: 15_000 });
    await this.mount();
  }

  private async mount(): Promise<void> {
    if (!this.page) throw new Error('El navegador todavía no está disponible. Cierra y vuelve a abrir la vista.');
    this.readyForFrames = false;
    await this.page.waitForFunction(() => (window as typeof window & { __wcLoaded?: boolean }).__wcLoaded, undefined, { timeout: 10_000 });
    const tags = await this.page.evaluate(() => (window as typeof window & { __wcTags?: string[] }).__wcTags ?? []);
    this.post({ type: 'tags', tags });
    await mountComponent(this.page, this.options);
    this.panel.title = `<${this.options.tag}>`;
    this.lastFrame = undefined;
    this.readyForFrames = true;
    this.post({ type: 'mounted', width: this.options.width, height: this.options.height });
  }

  private capture(): void {
    const tick = async () => {
      if (this.closed) return;
      try {
        if (this.readyForFrames && this.panel.visible && this.page && !this.page.isClosed()) {
          const frame = (await this.page.screenshot({ type: 'jpeg', quality: 80, timeout: 5000 })).toString('base64');
          if (frame !== this.lastFrame) { this.lastFrame = frame; this.post({ type: 'frame', data: frame }); }
        }
      } catch (error) { if (!this.closed) output.appendLine(`Captura: ${String(error)}`); }
      if (!this.closed) this.timer = setTimeout(() => { void tick(); }, Math.max(100, vscode.workspace.getConfiguration('wcVisualizer').get<number>('frameInterval', 250)));
    };
    void tick();
  }

  private async input(message: Record<string, unknown>): Promise<void> {
    const page = this.page;
    if (!page || !this.panel.visible) return;
    const x = Number(message.x), y = Number(message.y);
    switch (message.kind) {
      case 'move':
      case 'down':
      case 'up': {
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > this.options.width || y > this.options.height) return;
        await page.mouse.move(x, y);
        const button = message.button === 2 ? 'right' : message.button === 1 ? 'middle' : 'left';
        if (message.kind === 'down') await page.mouse.down({ button });
        if (message.kind === 'up') await page.mouse.up({ button });
        break;
      }
      case 'wheel': {
        const dx = Number(message.dx), dy = Number(message.dy);
        if (Number.isFinite(dx) && Number.isFinite(dy)) await page.mouse.wheel(Math.max(-2400, Math.min(2400, dx)), Math.max(-2400, Math.min(2400, dy)));
        break;
      }
      case 'text': if (typeof message.text === 'string' && message.text.length <= 1000) await page.keyboard.insertText(message.text); break;
      case 'key': if (typeof message.key === 'string' && message.key.length < 80) await page.keyboard.press(message.key); break;
    }
  }

  close(): Promise<void> { this.panel.dispose(); return this.dispose(); }
  private dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.closed = true;
    panels.delete(this);
    clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
    this.disposing = this.queue.then(async () => {
      await Promise.allSettled([this.runtime?.dispose(), this.context?.close()]);
    });
    return this.disposing;
  }
}

export async function deactivate(): Promise<void> {
  await Promise.all([...panels].map(panel => panel.close()));
  await pool?.dispose();
  pool = undefined;
}
