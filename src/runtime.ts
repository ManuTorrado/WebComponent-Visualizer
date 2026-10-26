import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import * as esbuild from 'esbuild';
import type { PreviewOptions } from './model';

export class PreviewRuntime {
  private build?: esbuild.BuildContext;
  private server?: Server;
  private files = new Map<string, Uint8Array>();
  private readonly token = randomBytes(24).toString('hex');
  url = '';
  buildError?: string;

  constructor(private readonly root: string, private readonly entry: string,
    private readonly onBuild: (error?: string) => void) {}

  async start(): Promise<void> {
    const output = path.join(this.root, '.wc-visualizer-memory');
    this.build = await esbuild.context({
      absWorkingDir: this.root, entryPoints: [this.entry], outdir: output,
      entryNames: 'component', bundle: true, write: false, format: 'esm',
      platform: 'browser', target: 'es2022', sourcemap: 'inline', logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"development"' },
      loader: { '.svg': 'dataurl', '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.gif': 'dataurl', '.webp': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
      plugins: [{ name: 'preview-output', setup: build => {
        build.onEnd(result => {
          if (result.errors.length) {
            this.buildError = result.errors.map(e => `${e.location ? `${e.location.file}:${e.location.line}: ` : ''}${e.text}`).join('\n');
            this.onBuild(this.buildError);
          } else {
            this.buildError = undefined;
            this.files = new Map(result.outputFiles?.map(file => ['/' + path.relative(output, file.path).split(path.sep).join('/'), file.contents]));
            this.onBuild();
          }
        });
      } }]
    });
    // A failing initial build still starts watching, so fixing the source recovers the preview.
    await this.build.rebuild().catch(() => {});
    this.server = createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const pathname = (req.url ?? '').split('?')[0];
      if (!pathname.startsWith(`/${this.token}/`)) { res.writeHead(404).end(); return; }
      const resource = pathname.slice(this.token.length + 1);
      if (resource === '/') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(this.document());
      } else if (this.files.has(resource)) {
        res.setHeader('Content-Type', resource.endsWith('.css') ? 'text/css' : 'text/javascript');
        res.end(this.files.get(resource));
      } else { res.writeHead(404).end(); }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('No se pudo iniciar el servidor local.');
    this.url = `http://127.0.0.1:${address.port}/${this.token}/`;
    await this.build.watch();
  }

  private document(): string {
    return `<!doctype html><html><head><meta charset="utf-8">${this.files.has('/component.css') ? '<link rel="stylesheet" href="component.css">' : ''}
      <style>body{margin:0;padding:32px;box-sizing:border-box;min-height:100vh;font-family:system-ui}*{box-sizing:border-box}</style></head>
      <body><main id="preview-root"></main><script type="module">
      const tags = []; const define = customElements.define.bind(customElements);
      customElements.define = (name, ctor, options) => { define(name, ctor, options); tags.push(name); };
      window.__wcTags = tags;
      window.__wcReady = import('./component.js').then(() => true).catch(error => {
        window.__wcImportError = String(error.stack || error); console.error(error); return false;
      }).finally(() => { window.__wcLoaded = true; });
      </script></body></html>`;
  }

  async dispose(): Promise<void> {
    await this.build?.dispose();
    if (this.server) {
      const server = this.server;
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    this.files.clear();
  }
}

/** Runs in the Chromium page, never in the extension host. */
export async function mountComponent(page: import('playwright').Page, options: PreviewOptions): Promise<string[]> {
  await page.setViewportSize({ width: options.width, height: options.height });
  await page.waitForFunction(() => (window as typeof window & { __wcLoaded?: boolean }).__wcLoaded, undefined, { timeout: 10_000 });
  return page.evaluate(async (o) => {
    const win = window as typeof window & { __wcReady: Promise<boolean>; __wcImportError?: string; __wcTags: string[] };
    await win.__wcReady;
    if (win.__wcImportError) throw new Error(win.__wcImportError);
    if (!customElements.get(o.tag)) throw new Error(`No se ha registrado <${o.tag}>. Selecciona otra etiqueta o importa su definición desde este archivo.`);
    document.body.style.background = o.background;
    const element = document.createElement(o.tag);
    for (const [key, value] of Object.entries(o.attributes)) {
      if (value !== false && value !== null) element.setAttribute(key, value === true ? '' : String(value));
    }
    Object.assign(element, o.properties);
    element.innerHTML = o.html;
    document.getElementById('preview-root')!.replaceChildren(element);
    return win.__wcTags;
  }, options);
}
