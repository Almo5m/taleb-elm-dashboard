import test from 'node:test';
import assert from 'node:assert/strict';
import { planBulkAction, scopeTargets } from '../../src/lib/bulk.js';

const profiles = [
  { id: 's1', role: 'student', banned: false },
  { id: 's2', role: 'student', banned: true },
  { id: 's3', role: 'student', banned: false },
  { id: 's4' }, // من غير role = طالب
  { id: 'm1', role: 'moderator' },
  { id: 'a1', role: 'admin' },
];

test('النطاق: طلاب بس في كل الحالات', () => {
  assert.deepEqual(scopeTargets(profiles, 'all'), ['s1', 's2', 's3', 's4']);
  assert.deepEqual(scopeTargets(profiles, 'filtered', { filteredIds: ['s1', 'm1', 'a1', 's3'] }), ['s1', 's3']);
  assert.deepEqual(scopeTargets(profiles, 'selected', { selected: new Set(['s2', 'a1', 'zzz']) }), ['s2']); // الأدمن والمجهول بيتشالوا
  assert.deepEqual(scopeTargets(profiles, 'selected', { selected: ['s4'] }), ['s4']);
  assert.deepEqual(scopeTargets(profiles, 'selected'), []);
  assert.deepEqual(scopeTargets(null, 'all'), []);
});

test('الخطة بتتخطّى اللي في الحالة دي أصلًا', () => {
  const ai = { s1: { enabled: true, daily_limit_override: 50 }, s2: { enabled: false, daily_limit_override: null }, s3: { enabled: true, daily_limit_override: null } };
  const ids = ['s1', 's2', 's3', 's4'];
  assert.deepEqual(planBulkAction('ai_on', ids, profiles, ai), { ids: ['s2', 's4'], skipped: 2 });
  assert.deepEqual(planBulkAction('ai_off', ids, profiles, ai), { ids: ['s1', 's3'], skipped: 2 }); // s4 مالوش صف = مقفول أصلًا
  assert.deepEqual(planBulkAction('ai_reset_limit', ids, profiles, ai), { ids: ['s1'], skipped: 3 });
  assert.deepEqual(planBulkAction('ban', ids, profiles, ai), { ids: ['s1', 's3', 's4'], skipped: 1 });
  assert.deepEqual(planBulkAction('unban', ids, profiles, ai), { ids: ['s2'], skipped: 3 });
  assert.deepEqual(planBulkAction('ai_off', [], profiles, {}), { ids: [], skipped: 0 });
  assert.deepEqual(planBulkAction('weird', ['s1'], profiles, {}), { ids: ['s1'], skipped: 0 });
});
