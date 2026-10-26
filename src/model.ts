export interface PreviewOptions {
  tag: string;
  attributes: Record<string, string | number | boolean | null>;
  properties: Record<string, unknown>;
  html: string;
  width: number;
  height: number;
  background: string;
}

export function validateOptions(value: unknown): PreviewOptions {
  const o = value as PreviewOptions;
  if (!o || typeof o.tag !== 'string' || !/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(o.tag)) {
    throw new Error('Introduce un nombre válido de custom element, por ejemplo my-button.');
  }
  for (const key of ['attributes', 'properties'] as const) {
    if (!o[key] || typeof o[key] !== 'object' || Array.isArray(o[key])) throw new Error(`${key} debe ser un objeto JSON.`);
    if (Object.keys(o[key]).some(k => ['__proto__', 'constructor', 'prototype'].includes(k))) throw new Error('Propiedad no permitida.');
  }
  if (Object.entries(o.attributes).some(([k, v]) => !/^[^\s"'>/=]+$/.test(k) || (v !== null && !['string', 'number', 'boolean'].includes(typeof v)))) {
    throw new Error('Los atributos deben contener valores simples y nombres válidos.');
  }
  if (typeof o.html !== 'string' || o.html.length > 100_000) throw new Error('Contenido HTML no válido o demasiado grande.');
  if (![o.width, o.height].every(v => Number.isInteger(v) && v >= 100 && v <= 2400)) throw new Error('El viewport debe medir entre 100 y 2400 px.');
  if (typeof o.background !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(o.background)) throw new Error('Color de fondo no válido.');
  return o;
}

// Discovery is a convenience only: runtime registrations and manual entry are also supported.
export function discoverTags(source: string): string[] {
  return [...new Set([...source.matchAll(/(?:customElements\s*\.\s*define\s*\(\s*|@customElement\s*\(\s*)['"]([a-z][a-z0-9]*(?:-[a-z0-9]+)+)['"]/g)].map(m => m[1]))];
}

export function defaultOptions(tag = 'my-component'): PreviewOptions {
  return { tag, attributes: {}, properties: {}, html: '', width: 900, height: 600, background: '#ffffff' };
}
