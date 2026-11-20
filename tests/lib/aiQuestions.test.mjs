import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryTone, cleanSearch, isLongQuestion, studentName } from '../../src/lib/aiQuestions.js';

test('تنضيف البحث', () => {
  assert.equal(cleanSearch('  معادلة%  _ الدرجة (التانية),  '), 'معادلة الدرجة التانية');
  assert.equal(cleanSearch(null), '');
  assert.equal(cleanSearch("a'b\"c*d"), 'a b c d');
});

test('تصنيف وطول وأسماء', () => {
  assert.equal(categoryTone('منهج'), 'forest');
  assert.equal(categoryTone('خارج النطاق'), 'coral');
  assert.equal(categoryTone(null), 'amber');
  assert.equal(isLongQuestion('قصير'), false);
  assert.equal(isLongQuestion('ا'.repeat(221)), true);
  assert.equal(isLongQuestion('1\n2\n3\n4\n5'), true);
  assert.equal(studentName({ a: 'منى' }, 'a'), 'منى');
  assert.equal(studentName({}, 'zz'), 'حساب محذوف');
});
