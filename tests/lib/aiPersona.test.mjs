import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_KNOWLEDGE, DEFAULT_PERSONA, KNOWLEDGE_MAX, PERSONA_MAX, counterState, currentVersion, isSameText, previewMessageProblem, validatePersona,
} from '../../src/lib/aiPersona.js';

// الافتراضي في اللوحة لازم يطابق الافتراضي في الدالة بالحرف (وإلا "استرجاع الافتراضي" يرجّع نص غير اللي بو بيستخدمه)
test('الافتراضي في اللوحة مطابق للدالة', () => {
  const ts = readFileSync(new URL('../../supabase/functions/ai-assistant/persona-defaults.ts', import.meta.url), 'utf8');
  const grab = (name) => ts.match(new RegExp(`export const ${name} = \`\\n([\\s\\S]*?)\\n\`\\.trim\\(\\);`))[1].trim();
  assert.equal(DEFAULT_PERSONA, grab('DEFAULT_PERSONA'));
  assert.equal(DEFAULT_KNOWLEDGE, grab('DEFAULT_KNOWLEDGE'));
});

test('الافتراضي نفسه جوه الحدود (وإلا الدالة هترفضه)', () => {
  assert.ok(DEFAULT_PERSONA.length > 200 && DEFAULT_PERSONA.length < PERSONA_MAX * 0.6, `الشخصية ${DEFAULT_PERSONA.length}`);
  assert.ok(DEFAULT_KNOWLEDGE.length > 200 && DEFAULT_KNOWLEDGE.length < KNOWLEDGE_MAX * 0.6, `المعرفة ${DEFAULT_KNOWLEDGE.length}`);
  assert.equal(validatePersona({ persona: DEFAULT_PERSONA, knowledge: DEFAULT_KNOWLEDGE }).error, null);
});

test('فحص النصين', () => {
  const ok = validatePersona({ persona: '  ش  ', knowledge: ' م ', note: '  تعديل  ' });
  assert.deepEqual(ok, { error: null, value: { persona: 'ش', knowledge: 'م', note: 'تعديل' } });
  assert.equal(validatePersona({ persona: 'ش', knowledge: 'م' }).value.note, null);
  assert.match(validatePersona({ persona: '  ', knowledge: 'م' }).error, /الشخصية فاضي/);
  assert.match(validatePersona({ persona: 'ش'.repeat(PERSONA_MAX + 1), knowledge: 'م' }).error, /أطول من الحد/);
  assert.match(validatePersona({ persona: 'ش', knowledge: '' }).error, /معرفة التطبيق فاضي/);
  assert.match(validatePersona({ persona: 'ش', knowledge: 'م'.repeat(KNOWLEDGE_MAX + 1) }).error, /أطول من الحد/);
  assert.match(validatePersona({ persona: 'ش', knowledge: 'م', note: 'ن'.repeat(201) }).error, /الملاحظة/);
  assert.equal(validatePersona({ persona: 'ش'.repeat(PERSONA_MAX), knowledge: 'م'.repeat(KNOWLEDGE_MAX) }).error, null);
  assert.match(validatePersona({}).error, /فاضي/);
});

test('عدّاد الحروف والمقارنة والنسخة الحالية', () => {
  assert.equal(counterState(100, 3000), 'ok');
  assert.equal(counterState(2700, 3000), 'near');
  assert.equal(counterState(3000, 3000), 'near');
  assert.equal(counterState(3001, 3000), 'over');
  assert.equal(isSameText(' a ', 'a'), true);
  assert.equal(isSameText('a', 'b'), false);
  assert.equal(isSameText(null, ''), true);
  assert.deepEqual(currentVersion([]), { persona: DEFAULT_PERSONA, knowledge: DEFAULT_KNOWLEDGE, isDefault: true, id: null });
  assert.equal(currentVersion(null).isDefault, true);
  assert.deepEqual(currentVersion([{ id: 7, persona: 'ش', knowledge: 'م' }, { id: 3, persona: 'x', knowledge: 'y' }]), { persona: 'ش', knowledge: 'م', isDefault: false, id: 7 });
  assert.notEqual(previewMessageProblem('  '), null);
  assert.notEqual(previewMessageProblem('س'.repeat(1001)), null);
  assert.equal(previewMessageProblem('سؤال'), null);
});
