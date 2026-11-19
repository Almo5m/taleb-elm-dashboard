import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allUnavailable, buildChain, earliestReturn, formatCairoTime, isValidModelName, modelStatusRows, moveItem, validateModelList,
} from '../../src/lib/aiModels.js';

test('اسم الموديل: نفس شرط الدالة', () => {
  assert.ok(isValidModelName('gemini-3.5-flash-lite'));
  assert.ok(isValidModelName('models/gemini-2.5-flash'));
  assert.ok(isValidModelName(' gemini-2.5-flash '));
  for (const bad of ['', 'a', '-gemini', 'gemini flash', 'جيميني', 'gem/ini', 'x'.repeat(62), null, undefined, 5]) {
    assert.equal(isValidModelName(bad), false, String(bad));
  }
});

test('فحص قايمة البدائل', () => {
  assert.equal(validateModelList(['a-b', 'c-d'], { primary: 'x-y' }).error, null);
  assert.match(validateModelList(['a-b', 'a-b'], { primary: 'x-y' }).error, /متكرر/);
  assert.match(validateModelList(['x-y'], { primary: 'x-y' }).error, /الأساسي/);
  assert.match(validateModelList(['models/x-y'], { primary: 'x-y' }).error, /الأساسي/);
  assert.match(validateModelList(['bad name'], { primary: 'x-y' }).error, /bad name/);
  assert.match(validateModelList(['m1', 'm2', 'm3', 'm4', 'm5'], { primary: 'x-y' }).error, /أقصى/);
  assert.deepEqual(validateModelList([' models/aa-bb '], {}).cleaned, ['aa-bb']);
  assert.deepEqual(validateModelList(undefined, {}).cleaned, []);
});

test('تحريك العناصر', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b']);
  const list = ['a', 'b'];
  assert.equal(moveItem(list, 0, -1), list);
  assert.equal(moveItem(list, 1, 1), list);
  assert.deepEqual(list, ['a', 'b']);
});

test('السلسلة بتطابق الدالة', () => {
  assert.deepEqual(buildChain('p-1', ['f-1', 'p-1', 'bad name', 'f-2']), ['p-1', 'f-1', 'f-2']);
  assert.deepEqual(buildChain('', null), ['gemini-2.5-flash-lite']);
  assert.equal(buildChain('a-a', ['b-b', 'c-c', 'd-d', 'e-e', 'f-f', 'g-g']).length, 5);
});

test('حالة الموديلات', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  const rows = [
    { model: 'a-a', exhausted_until: '2026-11-19T08:00:00Z', reason: 'quota_daily', detail: 'x' },
    { model: 'b-b', exhausted_until: '2026-11-18T11:00:00Z', reason: 'overloaded' }, // عدّى
    { model: 'c-c', exhausted_until: null, reason: null },
    { model: '__all_exhausted__', exhausted_until: '2026-12-01T00:00:00Z' },
    { model: 'd-d', exhausted_until: '2026-11-18T12:30:00Z', reason: 'weird' },
  ];
  const out = modelStatusRows(['a-a', 'b-b', 'c-c', 'd-d', 'e-e', '__all_exhausted__'], rows, now);
  assert.deepEqual(out.map((r) => r.available), [false, true, true, false, true, true]);
  assert.equal(out[0].reasonLabel, 'الحصة اليومية خلصت');
  assert.equal(out[3].reasonLabel, 'غير متاح');
  assert.equal(out[1].reasonLabel, null);
  assert.equal(earliestReturn(out), '2026-11-18T12:30:00.000Z');
  assert.equal(allUnavailable(out), false);
  assert.equal(allUnavailable(modelStatusRows(['a-a', 'd-d'], rows, now)), true);
  assert.equal(allUnavailable([]), false);
  assert.equal(earliestReturn(modelStatusRows(['c-c'], rows, now)), null);
});

test('وقت القاهرة', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.match(formatCairoTime('2026-11-18T18:00:00Z', now), /^النهارده/);
  assert.doesNotMatch(formatCairoTime('2026-11-19T08:00:00Z', now), /^النهارده/);
  // ١١ مساءً UTC = ١ صباحًا بالقاهرة اليوم اللي بعده (توقيت شتوي +٢)
  assert.doesNotMatch(formatCairoTime('2026-11-18T23:30:00Z', now), /^النهارده/);
  assert.equal(formatCairoTime(null), '—');
  assert.equal(formatCairoTime('nope'), '—');
});
