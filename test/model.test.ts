import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultOptions, discoverTags, validateOptions } from '../src/model';

test('discovers native and Lit registrations, deduplicating names', () => {
  assert.deepEqual(discoverTags(`customElements.define('a-card', A); @customElement("lit-button") class B {} customElements.define('a-card', A);`), ['a-card', 'lit-button']);
  assert.deepEqual(discoverTags(`customElements.define(dynamicName, Foo)`), []);
});

test('validates component name, viewport, JSON attributes and properties', () => {
  assert.equal(validateOptions(defaultOptions('demo-card')).tag, 'demo-card');
  for (const patch of [
    { tag: 'div' }, { tag: '<x-card>' }, { width: 0 }, { height: 9999 },
    { width: 100.5 }, { properties: [] }, { attributes: null },
    { attributes: { bad: {} } }, { attributes: { 'bad name': 'x' } },
    { background: 'url(http://example.com)' }, { html: 1 },
    { properties: JSON.parse('{"__proto__":{}}') }
  ]) assert.throws(() => validateOptions({ ...defaultOptions(), ...patch }), JSON.stringify(patch));
});

test('accepts boolean attributes and structured properties', () => {
  const options = { ...defaultOptions('demo-card'), attributes: { disabled: true, hidden: false, count: 2, omitted: null }, properties: { items: [{ id: 1 }] } };
  assert.equal(validateOptions(options), options);
});
