import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createApp } from '../server/app.js';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
function calculator() {
  const elements = new Map(), values = new Map(), writes = [], events = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', open: false, dataset: {}, style: {}, listeners: {}, renders: 0,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, focus() {}, reset() {}, dispatchEvent() {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      querySelectorAll() { return []; },
      set innerHTML(value) { this.markup = value; this.renders++; }, get innerHTML() { return this.markup; },
    });
    return elements.get(id);
  };
  const cups = [30, 50, 100, 250].map(ml => { const button = element(`cup${ml}`); button.dataset.cup = String(ml); return button; });
  const listeners = {};
  runInNewContext(html.match(/<script>\s*([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: element, querySelectorAll: selector => selector === '.scale-btn' ? cups : [] },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); writes.push(key); } },
    window: { addEventListener: (type, fn) => { listeners[type] = fn; }, dispatchEvent: event => events.push(event.type) },
    CustomEvent: class {}, Event: class { constructor(type) { this.type = type; } }, setTimeout: () => 1, clearTimeout() {},
  });
  return { element, values, writes, events, listeners, input(id, value) { element(id).value = value; element(id).listeners.input(); } };
}

test('repeated calculator input updates results immediately without rebuilding or rewriting presets', () => {
  const h = calculator(), list = h.element('presetList'), renders = list.renders;
  h.writes.length = 0;
  h.input('waterInput', '20');
  assert.equal(h.element('doseResultValue').textContent, '40');
  assert.equal(JSON.parse(h.values.get('carwash_yunseok_last_state_v1')).waterMl, 20000);
  h.input('waterInput', '20');
  assert.equal(list.renders, renders);
  assert.deepEqual(h.writes, ['carwash_yunseok_last_state_v1']);
});

test('new and remotely imported presets still render, persist and notify sync immediately', () => {
  const h = calculator();
  h.element('presetNameInput').value = '성능 테스트';
  h.element('presetRatioInput').value = '100';
  h.element('presetWaterInput').value = '2';
  h.element('presetForm').listeners.submit({ preventDefault() {} });
  const rows = JSON.parse(h.values.get('carwash_yunseok_presets_v1'));
  assert.equal(rows[0].name, '성능 테스트');
  assert.match(h.element('presetList').innerHTML, /성능 테스트/);
  assert.equal(h.element('doseResultValue').textContent, '20');
  assert.ok(h.events.includes('carwash-presets-changed'));
  h.values.set('carwash_yunseok_presets_v1', '[]');
  h.listeners['carwash-presets-imported']();
  assert.match(h.element('presetList').innerHTML, /저장된 케미컬 프리셋이 없습니다/);
});

test('unauthenticated session reads do not run database cleanup', async () => {
  const queries = [];
  const app = createApp({ run: async query => queries.push(query) }, { origin: 'http://localhost:8766', rpID: 'localhost' });
  const response = await app(new Request('http://localhost/api/session'));
  assert.equal(response.status, 401);
  assert.deepEqual(queries, []);
});


test('closed measuring details defer work while main dose and pump text update immediately', () => {
  const h = calculator();
  const ticks = h.element('cylinderTicks');
  assert.equal(ticks.renders, 0);
  h.input('pumpMlInput', '5');
  h.input('waterInput', '20');
  assert.equal(h.element('doseResultValue').textContent, '40');
  assert.match(h.element('pumpDoseText').textContent, /8회/);
  assert.equal(ticks.renders, 0);
  const details = h.element('measuringDetails');
  details.open = true;
  details.listeners.toggle();
  assert.match(h.element('cylinderCaption').textContent, /40ml 눈금/);
  assert.equal(h.element('pumpConversionText').textContent, h.element('pumpDoseText').textContent);
  assert.equal(ticks.renders, 1);
  h.input('waterInput', '21');
  h.input('waterInput', '21');
  assert.equal(ticks.renders, 1);
  assert.match(h.element('cylinderCaption').textContent, /42ml 눈금/);
});

test('measuring details preserve auto and manual cup selection, overflow and invalid recovery', () => {
  const h = calculator(), details = h.element('measuringDetails'), ticks = h.element('cylinderTicks');
  details.open = true;
  details.listeners.toggle();
  h.input('waterInput', '50');
  assert.match(ticks.innerHTML, />100ml</);
  h.element('cup30').listeners.click();
  assert.match(h.element('cylinderCaption').textContent, /30ml 계량컵 3번 가득 \+ 10ml 추가/);
  assert.equal(h.element('cylinderFill').style.width, '100.0%');
  const renders = ticks.renders;
  h.element('cup30').listeners.click();
  assert.equal(ticks.renders, renders);
  details.open = false;
  details.listeners.toggle();
  h.element('percentModeBtn').listeners.click();
  h.input('percentInput', '100');
  details.open = true;
  details.listeners.toggle();
  assert.equal(h.element('doseResultValue').textContent, '—');
  assert.equal(h.element('pumpConversionText').textContent, '—');
  h.input('percentInput', '1');
  assert.notEqual(h.element('doseResultValue').textContent, '—');
  assert.match(ticks.innerHTML, />250ml</);
  assert.match(h.element('ratioPercentageText').textContent, /1.00%/);
});


test('always visible concentration header stays current without opening measuring details', () => {
  const h = calculator();
  assert.equal(h.element('measuringDetails').open, false);
  h.input('ratioInput', '100');
  assert.equal(h.element('ratioPercentageText').textContent, '원액 농도 0.99%');
  h.element('percentModeBtn').listeners.click();
  h.input('percentInput', '2');
  assert.equal(h.element('ratioPercentageText').textContent, '원액 농도 2.00%');
  assert.equal(h.element('cylinderTicks').renders, 0);
});
