class CounterCard extends HTMLElement {
  private count = 0;
  static observedAttributes = ['label', 'accent'];
  private root = this.attachShadow({ mode: 'open' });

  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }

  render() {
    this.root.innerHTML = `
      <style>
        :host { display: block; max-width: 420px; font-family: system-ui; }
        article { padding: 30px; border: 1px solid #e2e5ed; border-radius: 18px; background: white; color: #172033; box-shadow: 0 10px 35px #1720330a; }
        small { color: #68748b; letter-spacing: .12em; font-size: 10px; font-weight: 700; }
        h2 { font-size: 26px; margin: 14px 0 8px; letter-spacing: -.04em; }
        p { color: #68748b; line-height: 1.6; font-size: 14px; }
        button { margin-top: 12px; background: var(--accent, #6554e8); color: white; font: inherit; font-weight: 600; border: none; border-radius: 9px; padding: 12px 20px; cursor: pointer; }
        button:hover { filter: brightness(1.1); } button:focus-visible { outline: 3px solid #b8adff; outline-offset: 3px; }
        input { display: block; width: 100%; box-sizing: border-box; padding: 10px; margin-top: 18px; border: 1px solid #d8deea; border-radius: 6px; }
        ::slotted(*) { color: #68748b; font-size: 13px; }
      </style>
      <article><small>WEB COMPONENT · SHADOW DOM</small><h2></h2>
      <p>Tu componente, dentro del editor. Cambia sus atributos o interactúa con él.</p>
      <slot name="description"></slot><input aria-label="Texto de prueba" placeholder="Prueba el teclado aquí…">
      <button type="button">Contador: ${this.count}</button><slot></slot></article>`;
    this.root.querySelector('h2')!.textContent = this.getAttribute('label') || 'Hola, Web Components';
    this.style.setProperty('--accent', this.getAttribute('accent') || '#6554e8');
    this.root.querySelector('button')!.addEventListener('click', () => {
      this.count++;
      this.root.querySelector('button')!.textContent = `Contador: ${this.count}`;
      this.dispatchEvent(new CustomEvent('count-change', { detail: this.count, bubbles: true, composed: true }));
    });
  }
}
customElements.define('counter-card', CounterCard);
