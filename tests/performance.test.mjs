import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createApp } from '../src/server/app.js';

const html = await readFile(new URL('../src/client/index.html', import.meta.url), 'utf8');
function calculator({ initial = {}, confirm = () => false, failWrites = false } = {}) {
  const elements = new Map(), values = new Map(Object.entries(initial)), writes = [], events = [], confirmations = [];
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
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (failWrites) throw new Error('quota'); values.set(key, value); writes.push(key); } },
    window: { confirm: message => { confirmations.push(message); return confirm(message); }, addEventListener: (type, fn) => { listeners[type] = fn; }, dispatchEvent: event => events.push(event.type) },
    CustomEvent: class {}, Event: class { constructor(type) { this.type = type; } }, setTimeout: () => 1, clearTimeout() {},
  });
  return { element, values, writes, events, listeners, confirmations, input(id, value) { element(id).value = value; element(id).listeners.input(); } };
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

test('invalid water and ratio inputs clear stale results and recover when corrected', () => {
  for (const id of ['waterInput', 'ratioInput']) {
    for (const value of ['', '0', '-1', 'Infinity']) {
      const h = calculator();
      h.element('measuringDetails').open = true;
      h.element('measuringDetails').listeners.toggle();
      h.input(id, value);
      assert.equal(h.element('doseResultValue').textContent, '—', `${id}=${value}`);
      assert.equal(h.element('copyResultBtn').disabled, true);
      assert.equal(h.element('togglePresetFormBtn').disabled, true);
      assert.equal(h.element('totalVolumeText').textContent, '—');
      h.input(id, id === 'waterInput' ? '20' : '100');
      assert.equal(h.element('doseResultValue').textContent, id === 'waterInput' ? '40' : '150');
      assert.equal(h.element('copyResultBtn').disabled, false);
      assert.equal(h.element('togglePresetFormBtn').disabled, false);
    }
  }
});

test('deletion during invalid concentration renders, persists and notifies sync immediately', () => {
  const h = calculator();
  h.element('percentModeBtn').listeners.click();
  h.input('percentInput', '100');
  const before = JSON.parse(h.values.get('carwash_yunseok_presets_v1'));
  h.events.length = 0;
  const button = { dataset: { action: 'delete', id: before[0].id } };
  h.element('presetList').listeners.click({ target: { closest: () => button }, stopPropagation() {} });
  const after = JSON.parse(h.values.get('carwash_yunseok_presets_v1'));
  assert.equal(after.length, before.length - 1);
  assert.equal(after.some(row => row.id === before[0].id), false);
  assert.doesNotMatch(h.element('presetList').innerHTML, /중성 카샴푸 표준/);
  assert.ok(h.events.includes('carwash-presets-changed'));
  assert.equal(h.element('doseResultValue').textContent, '—');
  h.listeners['carwash-presets-imported']();
  assert.equal(h.element('percentInput').value, '100', 'a server save acknowledgment must preserve unfinished calculator input');
  assert.equal(h.element('doseResultValue').textContent, '—');
});

test('a draft opened in A cannot be saved into B after another tab switches the shared list', () => {
  const h = calculator();
  h.values.set('carwash_local_owner_v1', 'vault-a');
  h.element('togglePresetFormBtn').listeners.click();
  h.element('presetNameInput').value = 'A 비공개 작성 내용';
  h.element('presetRatioInput').value = '100';
  h.element('presetWaterInput').value = '2';
  const b = [{ id: 'b', name: 'B 제품', category: '카샴푸', ratio: 500, waterL: 15 }];
  h.values.set('carwash_yunseok_presets_v1', JSON.stringify(b));
  h.values.set('carwash_local_owner_v1', 'vault-b');
  h.listeners.storage({ key: 'carwash_yunseok_presets_v1' });
  h.element('presetForm').listeners.submit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(h.values.get('carwash_yunseok_presets_v1')), b);
  assert.equal(h.element('presetNameInput').value, 'A 비공개 작성 내용');
  assert.match(h.element('presetFormError').textContent, /보관함/);
});

const presetsKey = 'carwash_yunseok_presets_v1';
const equipmentKey = 'carwash_equipment_v1';
const storedRow = (id, extra = {}) => ({ id, name: id, category: '카샴푸', ratio: 500, waterL: 15, pumpMl: 5, note: '', ...extra });
function removePreset(h, id) {
  h.element('presetList').listeners.click({ target: { closest: () => ({ dataset: { action: 'delete', id } }) }, stopPropagation() {} });
}
function choosePreset(h, id) {
  h.element('presetList').listeners.click({ target: { closest: selector => selector === '.preset-item' ? { dataset: { presetId: id } } : null } });
}
function saveEquipment(h, name, waterL) {
  h.element('equipmentNameInput').value = name;
  h.element('equipmentWaterInput').value = waterL;
  h.element('equipmentForm').listeners.submit({ preventDefault() {} });
}

test('equipment create, use, edit, delete and reload retain only validated device settings', () => {
  const h = calculator();
  saveEquipment(h, '내 분무기', '1.5');
  let items = JSON.parse(h.values.get(equipmentKey));
  assert.equal(items[0].name, '내 분무기');
  assert.equal(items[0].waterL, 1.5);
  h.element('equipmentSelect').value = items[0].id;
  h.element('equipmentApplyBtn').listeners.click();
  assert.equal(h.element('waterInput').value, 1.5);
  assert.equal(h.element('doseResultValue').textContent, '3');
  h.element('equipmentList').listeners.click({ target: { closest: () => ({ dataset: { equipmentAction: 'edit', id: items[0].id } }) } });
  saveEquipment(h, '큰 분무기', '2');
  items = JSON.parse(h.values.get(equipmentKey));
  assert.equal(items.length, 1);
  assert.equal(items[0].waterL, 2);
  const reloaded = calculator({ initial: Object.fromEntries(h.values) });
  assert.match(reloaded.element('equipmentSelect').innerHTML, /큰 분무기/);
  reloaded.element('equipmentList').listeners.click({ target: { closest: () => ({ dataset: { equipmentAction: 'delete', id: items[0].id } }) } });
  assert.deepEqual(JSON.parse(reloaded.values.get(equipmentKey)), []);
  assert.equal(JSON.parse(reloaded.values.get('carwash_yunseok_last_state_v1')).waterMl, 1500, 'deleting equipment does not change an existing calculation');
});

test('invalid equipment and unavailable storage never report a successful save', () => {
  for (const [name, water] of [['', '2'], ['x', '0'], ['x', '-1'], ['x', 'Infinity'], ['x', '1001'], ['x'.repeat(41), '1']]) {
    const h = calculator(); saveEquipment(h, name, water);
    assert.equal(h.values.has(equipmentKey), false);
    assert.match(h.element('equipmentStatus').textContent, /확인/);
  }
  const h = calculator({ failWrites: true }); saveEquipment(h, '버킷', '15');
  assert.match(h.element('equipmentStatus').textContent, /저장하지 못/);
  assert.doesNotMatch(h.element('equipmentSelect').innerHTML, /버킷/);
  const corrupted = calculator({ initial: { [equipmentKey]: '{broken' } });
  assert.match(corrupted.element('equipmentStatus').textContent, /읽지 못/);
});

test('equipment preserves product ratio and pump and asks before overriding manufacturer water', () => {
  const item = storedRow('제품', { waterGuidance: { waterL: 16, approximate: true, sourceUrl: 'https://example.com', claim: '물 약 16L' } });
  const initial = { [presetsKey]: JSON.stringify([item]), [equipmentKey]: JSON.stringify([{ id: 'e', name: '분무기', waterL: 2 }]) };
  for (const accepted of [false, true]) {
    const h = calculator({ initial, confirm: () => accepted }); choosePreset(h, item.id);
    h.element('equipmentSelect').value = 'e'; h.element('equipmentApplyBtn').listeners.click();
    assert.equal(h.element('waterInput').value, accepted ? 2 : 15);
    assert.match(h.confirmations[0], /16L/);
    assert.equal(h.element('ratioInput').value, 500);
    assert.equal(h.element('pumpMlInput').value, 5);
    assert.match(h.element('activeChemicalName').textContent, /제품/);
  }
});

test('equipment applies to a draft only after catalog method and water conditions are checked', () => {
  const h = calculator({ initial: { [equipmentKey]: JSON.stringify([{ id: 'e', name: '버킷', waterL: 15 }]) } });
  h.element('presetEquipmentSelect').value = 'e';
  h.element('presetWaterInput').value = '16';
  h.element('presetForm').catalogWaterBlocked = true;
  h.element('presetEquipmentApplyBtn').listeners.click();
  assert.equal(h.element('presetWaterInput').value, '16');
  assert.match(h.element('presetEquipmentStatus').textContent, /사용 방법|정량/);
  h.element('presetForm').catalogWaterBlocked = false;
  h.element('presetForm').waterGuidance = { waterL: 16, approximate: false, sourceUrl: '', claim: '권장 물량' };
  h.element('presetEquipmentApplyBtn').listeners.click();
  assert.equal(h.element('presetWaterInput').value, '16', 'cancel keeps recommended water');
  h.element('presetForm').waterGuidance = null;
  h.element('presetEquipmentApplyBtn').listeners.click();
  assert.equal(h.element('presetWaterInput').value, 15);
});

test('deletion undo restores only the removed row and not unrelated changes, including last row', () => {
  const h = calculator({ initial: { [presetsKey]: JSON.stringify([storedRow('a')]) } });
  removePreset(h, 'a');
  assert.deepEqual(JSON.parse(h.values.get(presetsKey)), []);
  assert.equal(h.element('undoDeletion').hidden, false);
  // Server acknowledgment and then an unrelated remote addition.
  h.listeners['carwash-presets-imported']();
  h.values.set(presetsKey, JSON.stringify([storedRow('b')])); h.listeners['carwash-presets-imported']();
  h.events.length = 0; h.element('undoDeleteBtn').listeners.click();
  assert.deepEqual(JSON.parse(h.values.get(presetsKey)).map(row => row.id), ['a', 'b']);
  assert.ok(h.events.includes('carwash-presets-changed'));
  assert.equal(h.element('undoDeletion').hidden, true);
});

test('successive deletions undo in reverse order without duplicating restored IDs', () => {
  const h = calculator({ initial: { [presetsKey]: JSON.stringify([storedRow('a'), storedRow('b')]) } });
  removePreset(h, 'a'); removePreset(h, 'b');
  h.element('undoDeleteBtn').listeners.click(); h.element('undoDeleteBtn').listeners.click();
  assert.deepEqual(JSON.parse(h.values.get(presetsKey)).map(row => row.id), ['a', 'b']);
  removePreset(h, 'a');
  h.values.set(presetsKey, JSON.stringify([storedRow('a', { ratio: 10 }), storedRow('b')]));
  h.listeners['carwash-presets-imported'](); h.element('undoDeleteBtn').listeners.click();
  assert.equal(JSON.parse(h.values.get(presetsKey))[0].ratio, 10);
  assert.equal(JSON.parse(h.values.get(presetsKey)).length, 2);
});

test('undo cannot carry a deleted product across vaults even before the storage event arrives', () => {
  const h = calculator({ initial: { [presetsKey]: JSON.stringify([storedRow('private-a')]), carwash_local_owner_v1: 'a' } });
  removePreset(h, 'private-a');
  h.values.set('carwash_local_owner_v1', 'b'); h.values.set(presetsKey, JSON.stringify([storedRow('private-b')]));
  h.element('undoDeleteBtn').listeners.click();
  assert.deepEqual(JSON.parse(h.values.get(presetsKey)).map(row => row.id), ['private-b']);
  assert.equal(h.element('undoDeletion').hidden, true);
});

test('reset asks with counts, cancels safely and detects changes while confirmation is open', () => {
  for (const accepted of [false, true]) {
    const h = calculator({ initial: { [presetsKey]: JSON.stringify([storedRow('custom')]) }, confirm: () => accepted });
    h.element('resetPresetsBtn').listeners.click();
    assert.match(h.confirmations[0], /1개/); assert.match(h.confirmations[0], /6개/);
    const rows = JSON.parse(h.values.get(presetsKey));
    assert.equal(rows.length, accepted ? 6 : 1);
    assert.equal(rows.some(row => row.id === 'custom'), !accepted);
  }
  let h;
  h = calculator({ confirm: () => { h.values.set(presetsKey, JSON.stringify([storedRow('remote')])); return true; } });
  h.element('resetPresetsBtn').listeners.click();
  assert.deepEqual(JSON.parse(h.values.get(presetsKey)).map(row => row.id), ['remote']);
});


test('small equipment water remains precise through both display units and preset creation', () => {
  const h = calculator({ initial: { [equipmentKey]: JSON.stringify([{ id: 'small', name: '소형 용기', waterL: 0.125 }]) } });
  h.element('equipmentSelect').value = 'small'; h.element('equipmentApplyBtn').listeners.click();
  assert.equal(h.element('waterInput').value, 0.125);
  h.element('unitMlBtn').listeners.click(); assert.equal(h.element('waterInput').value, 125);
  h.element('unitLiterBtn').listeners.click(); assert.equal(h.element('waterInput').value, 0.125);
  h.element('togglePresetFormBtn').listeners.click(); assert.equal(h.element('presetWaterInput').value, 0.125);
});

test('undo at the product limit retains its pending recovery rather than creating an unsyncable list', () => {
  const h = calculator({ initial: { [presetsKey]: JSON.stringify([storedRow('deleted')]) } });
  removePreset(h, 'deleted');
  h.values.set(presetsKey, JSON.stringify(Array.from({ length: 500 }, (_, i) => storedRow('p' + i))));
  h.listeners['carwash-presets-imported'](); h.element('undoDeleteBtn').listeners.click();
  assert.equal(JSON.parse(h.values.get(presetsKey)).length, 500);
  assert.equal(h.element('undoDeletion').hidden, false);
});


test('reset confirmation is tied to the original list even if a remote update is already rendered', () => {
  let h;
  h = calculator({ confirm: () => {
    h.values.set(presetsKey, JSON.stringify([storedRow('newer')]));
    h.listeners['carwash-presets-imported']();
    return true;
  } });
  h.element('resetPresetsBtn').listeners.click();
  assert.deepEqual(JSON.parse(h.values.get(presetsKey)).map(row => row.id), ['newer']);
});
