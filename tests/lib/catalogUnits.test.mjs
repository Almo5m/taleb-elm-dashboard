import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentTermOf, findDuplicateLesson, findDuplicateUnit, formatUnitTitle, labelKind, lessonCountsByUnit, lessonOrderChanged, lessonsOfUnit,
  moveLesson, moveUnit, ordinalWord, planBulkInUnit, planCurriculumCopy, planMoveLessons, reorderLessonRows, reorderUnitRows,
  termFromKey, termFromSelect, termKey, termSelectValue, unitCoverage, unitNumbers, unitOrderChanged, unitStatsMap, unitsOfTerm,
  unitStatsFallback, validateUnitLabel, validateUnitTitle,
} from '../../src/lib/catalogUnits.js';

test('نوع المسمى والترتيب بالكلام', () => {
  assert.equal(labelKind('وحدة'), 'feminine');
  assert.equal(labelKind('باب'), 'masculine');
  assert.equal(labelKind('فصل'), 'masculine');
  assert.equal(labelKind('Unit'), 'english');
  assert.equal(labelKind('  وحدة  '), 'feminine');
  assert.equal(ordinalWord(1, true), 'الأولى');
  assert.equal(ordinalWord(1, false), 'الأول');
  assert.equal(ordinalWord(11, true), 'الحادية عشرة');
  assert.equal(ordinalWord(11, false), 'الحادي عشر');
  assert.equal(ordinalWord(12, true), 'الثانية عشرة');
  assert.equal(ordinalWord(19, false), 'التاسع عشر');
  assert.equal(ordinalWord(20, true), 'العشرون');
  assert.equal(ordinalWord(20, false), 'العشرون');
  assert.equal(ordinalWord(21, true), null);
  assert.equal(ordinalWord(0, true), null);
  for (let n = 1; n <= 20; n += 1) { assert.ok(ordinalWord(n, true)); assert.ok(ordinalWord(n, false)); }
});

test('عنوان الوحدة زي ما هيظهر للطالب (أمثلة الوصف)', () => {
  assert.equal(formatUnitTitle('باب', 1, 'الكيمياء الكهربية'), 'الباب الأول: الكيمياء الكهربية');
  assert.equal(formatUnitTitle('وحدة', 2, 'التفاعلات'), 'الوحدة الثانية: التفاعلات');
  assert.equal(formatUnitTitle('Unit', 2, 'Family'), 'Unit 2: Family');
  assert.equal(formatUnitTitle('فصل', 10, 'س'), 'الفصل العاشر: س');
  assert.equal(formatUnitTitle('وحدة', 20, 'س'), 'الوحدة العشرون: س');
  assert.equal(formatUnitTitle('باب', 21, 'س'), 'الباب ٢١: س');
  assert.equal(formatUnitTitle('Unit', 21, 'x'), 'Unit 21: x');
  assert.equal(formatUnitTitle('الباب', 1, 'س'), 'الباب الأول: س', 'مبنكرّرش ال');
  assert.equal(formatUnitTitle('', 1, 'س'), 'الوحدة الأولى: س', 'مسمى فاضي = وحدة');
  assert.equal(formatUnitTitle('وحدة دراسية', 3, 'س'), 'الوحدة دراسية الثالثة: س'.replace('الوحدة دراسية', 'الوحدة دراسية'));
  assert.equal(formatUnitTitle('وحدة', null, '  اسم  '), 'اسم', 'الوحدة المخفية من غير رقم');
});

const U = (id, term, order, active = true, title = `u${id}`) => ({ id, subject_id: 's1', title, term, sort_order: order, is_active: active });

test('الترقيم جوه كل ترم، والمخفية بتتخطى', () => {
  const units = [U(1, 1, 1), U(2, 2, 2), U(3, 1, 3, false), U(4, 1, 4), U(5, null, 5), U(6, 2, 6), U(7, null, 7)];
  const n = unitNumbers(units);
  assert.deepEqual(n, { 1: 1, 3: null, 4: 2, 2: 1, 6: 2, 5: 1, 7: 2 });
  assert.deepEqual(unitsOfTerm(units, 1).map((u) => u.id), [1, 3, 4]);
  assert.deepEqual(unitsOfTerm(units, null).map((u) => u.id), [5, 7]);
  assert.deepEqual(unitNumbers([]), {});
});

test('تحريك وحدة جوه ترمها بس', () => {
  const units = [U(1, 1, 1), U(2, 2, 2), U(3, 1, 3), U(4, 2, 4)];
  // وحدة 3 (ترم ١) لفوق: بتعدّي وحدة 2 (ترم ٢) وتتبدل مع 1
  assert.deepEqual(moveUnit(units, 3, -1).map((u) => u.id), [3, 2, 1, 4]);
  assert.deepEqual(moveUnit(units, 1, 1).map((u) => u.id), [3, 2, 1, 4]);
  // العرض بيتحرك فعلًا: الترتيب بـ sort_order بعد الحركة بيطلّع نفس الترتيب الجديد والأرقام بتتحدّث
  const after = moveUnit(units, 3, -1);
  assert.deepEqual(after.map((u) => u.sort_order), [1, 2, 3, 4]);
  assert.deepEqual(unitsOfTerm(after, 1).map((u) => u.id), [3, 1]);
  assert.deepEqual([unitNumbers(after)[3], unitNumbers(after)[1]], [1, 2]);
  assert.equal(moveUnit(units, 1, -1), units, 'مفيش حركة');
  assert.equal(moveUnit(units, 4, 1), units);
  assert.equal(moveUnit(units, 99, 1), units);
});

test('صفوف حفظ الترتيب متتالية من ١ وبتحتفظ بباقي الحقول', () => {
  const rows = reorderUnitRows([U(9, 2, 50), U(4, null, 7, false)]);
  assert.deepEqual(rows, [
    { id: 9, subject_id: 's1', title: 'u9', term: 2, is_active: true, sort_order: 1 },
    { id: 4, subject_id: 's1', title: 'u4', term: null, is_active: false, sort_order: 2 },
  ]);
  assert.equal(unitOrderChanged([U(1, 1, 1), U(2, 1, 2)], [U(2, 1, 1), U(1, 1, 2)]), true);
  assert.equal(unitOrderChanged([U(1, 1, 1)], [U(1, 1, 1)]), false);
});

test('فحص اسم الوحدة ومسماها', () => {
  assert.equal(validateUnitTitle('الكيمياء الكهربية'), null);
  assert.equal(validateUnitTitle('التفاعلات'), null);
  assert.equal(validateUnitTitle('وحدة الطاقة'), null, 'كلمة وحدة جوه جملة عادية');
  assert.equal(validateUnitTitle('الباب الأولياء والصالحين'), null, 'بداية كلمة أطول مش رقم');
  assert.equal(validateUnitTitle('فصل الأول الكيمياء') === null, false);
  assert.equal(validateUnitTitle('Family and Friends'), null);
  assert.notEqual(validateUnitTitle(''), null);
  assert.notEqual(validateUnitTitle('   '), null);
  assert.notEqual(validateUnitTitle('x'.repeat(201)), null);
  for (const bad of ['الباب الأول: الكيمياء', 'الوحدة 2 التفاعلات', 'باب 3', 'Unit 2: Family', 'فصل ١ الحركة', 'الوحدة الثانية']) {
    assert.match(validateUnitTitle(bad) || '', /من غير رقم/, bad);
  }
  assert.equal(validateUnitLabel('باب'), null);
  assert.equal(validateUnitLabel('Unit'), null);
  assert.notEqual(validateUnitLabel(''), null);
  assert.notEqual(validateUnitLabel('x'.repeat(21)), null);
  assert.equal(validateUnitLabel('x'.repeat(20)), null);
});

test('تكرار الوحدة جوه المادة والترم، والدرس جوه الوحدة', () => {
  const units = [U(1, 1, 1, true, 'التفاعلات'), U(2, 2, 2, true, 'التفاعلات')];
  assert.equal(findDuplicateUnit(units, '  التفاعلات ', 1)?.id, 1);
  assert.equal(findDuplicateUnit(units, 'التفاعلات', null), null, 'ترم مختلف مسموح');
  assert.equal(findDuplicateUnit(units, 'التفاعلات', 1, 1), null, 'نفسها مش تكرار');
  const lessons = [
    { id: 1, subject_id: 's1', unit_id: 10, title: 'مراجعة', sort_order: 1, is_active: true },
    { id: 2, subject_id: 's1', unit_id: 11, title: 'مراجعة', sort_order: 1, is_active: true },
    { id: 3, subject_id: 's1', unit_id: null, title: 'درس قديم', sort_order: 1, is_active: true },
  ];
  assert.equal(findDuplicateLesson(lessons, 10, ' مراجعة ')?.id, 1);
  assert.equal(findDuplicateLesson(lessons, 12, 'مراجعة'), null, 'وحدة تانية مسموح');
  assert.equal(findDuplicateLesson(lessons, null, 'مراجعة'), null, 'من غير وحدة: جوه المادة بس');
  assert.equal(findDuplicateLesson(lessons, null, 'DERS'.toLowerCase()), null);
  assert.equal(findDuplicateLesson(lessons, 10, 'مراجعة', 1), null);
  assert.deepEqual(planBulkInUnit('مراجعة\nجديد\nجديد\n\n', lessons, 10), { toAdd: ['جديد'], duplicates: 2, tooLong: 0, skipped: 2 });
  assert.deepEqual(planBulkInUnit('مراجعة', lessons, 11).toAdd, [], 'المكرر في وحدته');
  assert.deepEqual(planBulkInUnit('مراجعة', lessons, 99).toAdd, ['مراجعة']);
  assert.deepEqual(lessonCountsByUnit([...lessons, { id: 4, unit_id: 10, is_active: false }]), { 10: { visible: 1, hidden: 1 }, 11: { visible: 1, hidden: 0 }, none: { visible: 1, hidden: 0 } });
});

const L = (id, unit, order, title = `l${id}`, active = true) => ({ id, subject_id: 's1', unit_id: unit, title, sort_order: order, is_active: active });

test('تحريك درس جوه وحدته وحفظ ترتيبها بس', () => {
  const lessons = [L(1, 10, 1), L(2, 10, 2), L(3, 11, 1), L(4, 10, 3)];
  const moved = moveLesson(lessons, 4, -1);
  assert.deepEqual(lessonsOfUnit(moved, 10).map((l) => l.id), [1, 4, 2]);
  assert.deepEqual(lessonsOfUnit(moved, 11).map((l) => l.id), [3], 'وحدة تانية متتأثرش');
  assert.equal(moveLesson(lessons, 1, -1), lessons);
  assert.equal(moveLesson(lessons, 3, 1), lessons);
  assert.equal(moveLesson(lessons, 99, 1), lessons);
  assert.equal(lessonOrderChanged(lessons, moved, 10), true);
  assert.equal(lessonOrderChanged(lessons, moved, 11), false);
  assert.deepEqual(reorderLessonRows(moved, 10).map((r) => [r.id, r.sort_order]), [[1, 1], [4, 2], [2, 3]]);
  assert.equal(reorderLessonRows(moved, 10)[0].unit_id, 10);
});

test('نقل دروس بين الوحدات: تخطي المكرر وإضافة بعد آخر ترتيب', () => {
  const lessons = [L(1, null, 1, 'أ'), L(2, null, 2, 'ب'), L(3, null, 3, 'مراجعة'), L(10, 7, 1, 'مراجعة'), L(11, 7, 2, 'ج'), L(12, 8, 1, 'د')];
  const target = { id: 7, subject_id: 's1' };
  const plan = planMoveLessons(lessons, [3, 1, 2, 11], target);
  assert.equal(plan.moved, 2);
  assert.deepEqual(plan.rows.map((r) => [r.id, r.unit_id, r.sort_order]), [[1, 7, 3], [2, 7, 4]]);
  assert.deepEqual(plan.skipped.map((s) => [s.title, s.reason]).sort(), [['ج', 'same'], ['مراجعة', 'duplicate']].sort());
  // نفس المجموعة المنقولة فيها تكرار جوه بعض
  const dupInside = planMoveLessons([L(1, null, 1, 'س'), L(2, null, 2, ' س ')], [1, 2], target);
  assert.equal(dupInside.moved, 1);
  // وحدة من مادة تانية
  const other = planMoveLessons(lessons, [1], { id: 99, subject_id: 'other' });
  assert.deepEqual(other.skipped, [{ title: 'أ', reason: 'subject' }]);
  assert.deepEqual(planMoveLessons(lessons, [], target), { rows: [], moved: 0, skipped: [] });
});

test('نسخ المنهج: وحدات ودروس مع تخطي المكرر ودمج الوحدة الموجودة', () => {
  const sourceUnits = [U(1, 1, 1, true, 'الأولى'), U(2, 2, 2, true, 'التانية'), U(3, 1, 3, false, 'مخفية')];
  const sourceLessons = [L(1, 1, 1, 'أ'), L(2, 1, 2, 'ب'), L(3, 1, 3, 'مخفي', false), L(4, 2, 1, 'ج'), L(5, 3, 1, 'د'), L(6, null, 1, 'قديم'), L(7, null, 2, 'قديم٢', false)];
  const targetUnits = [{ id: 50, subject_id: 't', title: ' الأولى ', term: 1, sort_order: 4, is_active: true }];
  const targetLessons = [{ id: 90, subject_id: 't', unit_id: 50, title: 'أ', sort_order: 1, is_active: true }, { id: 91, subject_id: 't', unit_id: null, title: 'قديم', sort_order: 1, is_active: true }];
  const plan = planCurriculumCopy({ sourceUnits, sourceLessons, targetUnits, targetLessons });
  assert.deepEqual(plan.mergeUnits, [{ unitId: 50, title: ' الأولى ', toAdd: ['ب'], startOrder: 2 }]);
  assert.deepEqual(plan.createUnits, [{ title: 'التانية', term: 2, sort_order: 5, lessons: ['ج'] }]);
  assert.deepEqual(plan.noUnit, []);
  assert.equal(plan.skippedLessons, 2); // أ في الوحدة، وقديم من غير وحدة
  assert.equal(plan.addedLessons, 2);
  assert.equal(plan.addedUnits, 1);
  const empty = planCurriculumCopy({ sourceUnits, sourceLessons, targetUnits: [], targetLessons: [] });
  assert.equal(empty.createUnits.length, 2);
  assert.deepEqual(empty.createUnits.map((u) => u.sort_order), [1, 2]);
  assert.deepEqual(empty.noUnit, ['قديم']);
  assert.equal(empty.addedLessons, 4);
});

test('الترم الحالي والاختيارات والتغطية', () => {
  assert.equal(currentTermOf({ term: 1 }), 1);
  assert.equal(currentTermOf({ term: '2' }), 2);
  for (const bad of [null, undefined, {}, { term: 3 }, { term: 'x' }, 1, 'a']) assert.equal(currentTermOf(bad), null, String(bad));
  assert.equal(termKey(null), 'year'); assert.equal(termKey(1), '1'); assert.equal(termKey(2), '2'); assert.equal(termKey(5), 'year');
  assert.equal(termFromKey('1'), 1); assert.equal(termFromKey('year'), null);
  assert.equal(termFromSelect('2'), 2); assert.equal(termFromSelect(''), null);
  assert.equal(termSelectValue(1), '1'); assert.equal(termSelectValue(null), '');
  const stats = unitStatsMap([{ subject_id: 'a', units_count: 3, no_unit_visible: 5, no_unit_hidden: 1 }, { subject_id: 'b', units_count: 0, no_unit_visible: 2, no_unit_hidden: 0 }]);
  assert.deepEqual(unitCoverage([{ id: 'a' }, { id: 'b' }, { id: 'c' }], stats), { withUnits: 1, noUnitLessons: 7, total: 3 });
});

test('احتياطي إحصائيات الوحدات', () => {
  assert.deepEqual(
    unitStatsFallback([{ subject_id: 'a' }, { subject_id: 'a' }, { subject_id: 'b' }], [{ subject_id: 'a', is_active: true }, { subject_id: 'c', is_active: false }]),
    { a: { units: 2, noUnitVisible: 1, noUnitHidden: 0 }, b: { units: 1, noUnitVisible: 0, noUnitHidden: 0 }, c: { units: 0, noUnitVisible: 0, noUnitHidden: 1 } },
  );
  assert.deepEqual(unitStatsFallback(null, null), {});
});
