import { chromium, type Browser } from 'playwright';

/** One Chromium process per extension host, including concurrent preview requests. */
export class BrowserPool {
  private pending?: Promise<Browser>;
  private stopped = false;

  constructor(private readonly executablePath?: string) {}

  acquire(): Promise<Browser> {
    if (this.stopped) return Promise.reject(new Error('El navegador está detenido. Abre otra previsualización para reiniciarlo.'));
    if (!this.pending) {
      this.pending = chromium.launch({ headless: true, executablePath: this.executablePath || undefined }).then(async browser => {
        if (this.stopped) {
          await browser.close();
          throw new Error('El navegador fue detenido durante el arranque.');
        }
        browser.on('disconnected', () => { this.pending = undefined; });
        return browser;
      }).catch(error => { this.pending = undefined; throw error; });
    }
    return this.pending;
  }

  async dispose(): Promise<void> {
    this.stopped = true;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) await pending.then(browser => browser.close()).catch(() => {});
  }
}
