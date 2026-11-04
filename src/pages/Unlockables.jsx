import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppUser } from '../context/AppUser';
import { PageHeader, Spinner, Stamp, EmptyState, useToast, useConfirm } from '../components/UI';
import { logAction } from '../lib/audit';
import { fetchSetting, writeSetting } from '../lib/appSettings';
import { UNLOCKABLE_FEATURES } from '../constants/unlockables';
import {
  CONDITION_TYPES, KIND_OPTIONS, TITLE_MAX, DESCRIPTION_MAX, getFeature, getKindLabel, describeCondition,
  previewText, validateItem, validateUnlockables, normalizeItem, diffUnlockables, hasChanges, canonical,
} from '../lib/unlockables';

const SETTING_KEY = 'unlockables';
const toWesternDigits = (text) => String(text).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

const EMPTY_FORM = {
  mode: 'add', original_id: null, feature_id: '', condition_type: '', value: '', title: '', description: '', enabled: true,
};

const labelClass = 'text-xs text-muted font-semibold block mb-1';

export default function Unlockables() {
  const me = useAppUser();
  const toast = useToast();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [storedInvalid, setStoredInvalid] = useState(false); // القيمة المحفوظة مش مصفوفة
  const [items, setItems] = useState([]); // نسخة التعديل (مسودة لحد ما تدوس حفظ)
  const [saved, setSaved] = useState([]); // آخر نسخة محفوظة فعلًا
  const [kindFilter, setKindFilter] = useState('');
  const [form, setForm] = useState(null);
  const [formErrors, setFormErrors] = useState([]);
  const [saveErrors, setSaveErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const baseRef = useRef(canonical([])); // اللي قريناه من الداتابيز، لكشف التعديل من مكان تاني

  const load = useCallback(async () => {
    setLoading(true);
    const { error, value } = await fetchSetting(SETTING_KEY);
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    const isList = Array.isArray(value);
    const list = isList ? value : [];
    setLoadError(false);
    setStoredInvalid(value !== null && !isList);
    setItems(list);
    setSaved(list);
    baseRef.current = canonical(value ?? []);
    setForm(null);
    setFormErrors([]);
    setSaveErrors([]);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => canonical(items) !== canonical(saved), [items, saved]);

  // تحذير قبل ما الأدمن يقفل الصفحة وفيها تعديلات مش محفوظة
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // مشاكل كل قاعدة (بتظهر دايمًا — ممكن تكون جاية من قيمة قديمة غلط)
  const problems = useMemo(() => {
    const map = new Map();
    validateUnlockables(items).errors.forEach((e) => map.set(e.index, e.messages));
    return map;
  }, [items]);

  const usedFeatureIds = useMemo(() => new Set(items.map((i) => i?.feature_id)), [items]);
  const availableFeatures = UNLOCKABLE_FEATURES.filter((f) => !usedFeatureIds.has(f.feature_id));

  const rows = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !kindFilter || item?.kind === kindFilter);

  // ---------- الفورم ----------
  const openAdd = () => {
    setFormErrors([]);
    setForm({ ...EMPTY_FORM });
  };

  const openEdit = (item) => {
    setFormErrors([]);
    setForm({
      mode: 'edit',
      original_id: item.feature_id,
      // ميزة اتشالت من الكتالوج: بنسيب الاختيار فاضي عشان الأدمن يحوّل القاعدة لميزة بديلة
      feature_id: getFeature(item.feature_id) ? item.feature_id : '',
      condition_type: item.condition?.type ?? '',
      value: String(item.condition?.value ?? ''),
      title: item.title ?? '',
      description: item.description ?? '',
      enabled: item.enabled === true,
    });
  };

  const onPickFeature = (featureId) => {
    const feature = getFeature(featureId);
    // العنوان بيتعبّى تلقائي باسم الميزة (تقدر تعدّله)
    setForm((prev) => ({ ...prev, feature_id: featureId, title: prev.title || feature?.label || '' }));
  };

  const formCandidate = () => {
    const feature = getFeature(form.feature_id);
    const valueText = toWesternDigits(form.value).trim();
    return {
      feature_id: form.feature_id,
      kind: feature?.kind,
      title: form.title,
      description: form.description,
      condition: { type: form.condition_type, value: /^\d+$/.test(valueText) ? Number(valueText) : NaN },
      enabled: form.enabled,
    };
  };

  const submitForm = () => {
    if (!getFeature(form.feature_id)) {
      setFormErrors(['اختار الميزة الأول']);
      return;
    }
    const candidate = formCandidate();
    const messages = validateItem(candidate);
    const takenByAnother = usedFeatureIds.has(form.feature_id) && form.feature_id !== form.original_id;
    if (takenByAnother) messages.push('الميزة دي ليها قاعدة بالفعل');
    if (messages.length) {
      setFormErrors(messages);
      return;
    }

    const normalized = normalizeItem(candidate);
    setItems((prev) => (form.mode === 'add'
      ? [...prev, normalized]
      : prev.map((item) => (item?.feature_id === form.original_id ? normalized : item))));
    setForm(null);
    setFormErrors([]);
    toast(form.mode === 'add'
      ? 'اتضافت القاعدة — دوس "حفظ التغييرات" عشان تتطبّق'
      : 'اتعدّلت القاعدة — دوس "حفظ التغييرات" عشان تتطبّق');
  };

  // ---------- عمليات القايمة (كلها على المسودة) ----------
  const toggleEnabled = (index) =>
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, enabled: !item.enabled } : item)));

  const move = (index, direction) =>
    setItems((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const remove = async (index) => {
    const item = items[index];
    const ok = await confirm(
      `متأكد إنك عايز تمسح قاعدة القفل "${item?.title || item?.feature_id}"؟ الميزة هتبقى مفتوحة للجميع بعد الحفظ.`,
      { danger: true, confirmLabel: 'حذف' }
    );
    if (!ok) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
    setForm(null);
  };

  const discard = async () => {
    const ok = await confirm('هتتراجع عن كل التغييرات اللي لسه مش محفوظة. متأكد؟', { danger: true, confirmLabel: 'تراجع' });
    if (!ok) return;
    setItems(saved);
    setForm(null);
    setSaveErrors([]);
  };

  // ---------- الحفظ الذري ----------
  const save = async () => {
    // 1) تحقق من كل العناصر قبل أي كتابة — لو فيه واحد غلط مفيش حاجة بتتكتب
    const result = validateUnlockables(items);
    if (!result.ok) {
      setSaveErrors(result.errors);
      toast(`فيه ${result.errors.length} قاعدة فيها مشاكل — مفيش حاجة اتحفظت`, 'error');
      return;
    }
    setSaveErrors([]);

    const diff = diffUnlockables(saved, result.items);
    if (!hasChanges(diff)) {
      setItems(result.items);
      toast('مفيش تغيير للحفظ');
      return;
    }

    setSaving(true);

    // 2) نتأكد إن حد تاني ما غيّر القواعد من وقت ما فتحت الصفحة (عشان مانمسحش تعديلاته)
    const current = await fetchSetting(SETTING_KEY);
    if (current.error) {
      setSaving(false);
      toast('تعذّر التأكد من آخر نسخة — حاول تاني', 'error');
      return;
    }
    if (canonical(current.value ?? []) !== baseRef.current) {
      setSaving(false);
      toast('القواعد اتغيّرت من مكان تاني بعد ما فتحت الصفحة — حدّث الصفحة الأول عشان متمسحش تعديلات حد', 'error');
      return;
    }

    // 3) استبدال المصفوفة كلها دفعة واحدة
    const { error } = await writeSetting(SETTING_KEY, result.items);
    setSaving(false);
    if (error) {
      toast('تعذّر الحفظ', 'error');
      return;
    }

    setSaved(result.items);
    setItems(result.items);
    setStoredInvalid(false);
    baseRef.current = canonical(result.items);
    logAction({
      adminId: me?.id,
      adminName: me?.name || 'أدمن',
      action: 'تعديل المميزات المقفولة',
      targetType: 'app_settings',
      targetId: SETTING_KEY,
      details: { ...diff, total: result.items.length },
    });
    toast('تم حفظ المميزات المقفولة');
  };

  // ---------- العرض ----------
  const isOrphanEdit = !!form && form.mode === 'edit' && !getFeature(form.original_id);
  const formPreview = form ? previewText({ title: form.title, condition: formCandidate().condition }) : null;

  if (loading) return <Spinner />;

  if (loadError) {
    return (
      <div>
        <PageHeader eyebrow="التطبيق" title="المميزات المقفولة" />
        <EmptyState icon="⚠" title="تعذّر تحميل القواعد" hint="مفيش حاجة اتغيّرت. جرّب تاني." />
        <div className="text-center mt-4"><button onClick={load} className="btn-primary">إعادة المحاولة</button></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="التطبيق"
        title="المميزات المقفولة"
        action={
          <button onClick={openAdd} disabled={availableFeatures.length === 0 || !!form} className="btn-primary">
            إضافة قاعدة
          </button>
        }
      />
      <p className="text-xs text-muted mb-5 -mt-4">
        الميزة اللي مفيش ليها قاعدة هنا بتفضل مفتوحة للجميع. التطبيق بيقرا القواعد بس وبيحسب الشرط على جهاز الطالب.
      </p>

      {storedInvalid && (
        <div className="card p-4 mb-5 bg-coral/10 border border-coral/30">
          <p className="text-sm font-semibold text-coral-dark">
            القيمة المحفوظة حاليًا مش مصفوفة قواعد. التطبيق مش هيقدر يقراها — أول حفظ هيستبدلها بالقواعد اللي في الصفحة.
          </p>
        </div>
      )}

      {/* شريط الحفظ */}
      <div className="card p-4 mb-5 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{items.length} قاعدة</p>
          <p className={`text-xs ${dirty ? 'text-gold-dark font-semibold' : 'text-muted'}`}>
            {dirty ? 'فيه تغييرات لسه مش محفوظة' : 'كل التغييرات محفوظة'}
          </p>
        </div>
        <button onClick={discard} disabled={!dirty || saving} className="btn-ghost">تراجع عن التغييرات</button>
        <button onClick={save} disabled={!dirty || saving} className="btn-primary">
          {saving ? 'جارِ الحفظ...' : 'حفظ التغييرات'}
        </button>
      </div>

      {saveErrors.length > 0 && (
        <div className="card p-4 mb-5 bg-coral/10 border border-coral/30" role="alert">
          <p className="text-sm font-bold text-coral-dark mb-2">الحفظ اترفض — صلّح الأخطاء دي الأول:</p>
          <ul className="text-sm text-coral-dark list-disc pr-5 space-y-1">
            {saveErrors.map((e) => (
              <li key={`${e.index}-${e.featureId}`}>
                {e.index >= 0 ? `قاعدة رقم ${e.index + 1}${items[e.index]?.title ? ` (${items[e.index].title})` : ''}: ` : ''}
                {e.messages.join(' — ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* فورم الإضافة/التعديل */}
      {form && (
        <div className="card p-5 mb-5">
          <p className="font-messiri font-bold mb-4">{form.mode === 'add' ? 'قاعدة جديدة' : 'تعديل القاعدة'}</p>

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="md:col-span-2">
              <label className={labelClass}>الميزة</label>
              {form.mode === 'edit' && !isOrphanEdit ? (
                <p className="input-field bg-parchment/60">
                  {getFeature(form.feature_id)?.label ?? form.feature_id}
                </p>
              ) : (
                <>
                  {isOrphanEdit && (
                    <p className="text-[11px] text-coral-dark font-semibold mb-1">
                      الميزة القديمة ({form.original_id}) مش موجودة في الكتالوج — اختار ميزة بديلة للقاعدة دي أو الغي وامسحها.
                    </p>
                  )}
                  <select value={form.feature_id} onChange={(e) => onPickFeature(e.target.value)} className="input-field">
                    <option value="">اختار الميزة...</option>
                    {KIND_OPTIONS.map((kind) => {
                      const features = availableFeatures.filter((f) => f.kind === kind.id);
                      return features.length === 0 ? null : (
                        <optgroup key={kind.id} label={kind.label}>
                          {features.map((f) => <option key={f.feature_id} value={f.feature_id}>{f.label}</option>)}
                        </optgroup>
                      );
                    })}
                  </select>
                </>
              )}
            </div>
            <div>
              <label className={labelClass}>نوع الشرط</label>
              <select
                value={form.condition_type}
                onChange={(e) => setForm({ ...form, condition_type: e.target.value })}
                className="input-field"
              >
                <option value="">اختار...</option>
                {CONDITION_TYPES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>
                القيمة {form.condition_type === 'average_grade_min' ? '(من 1 لـ 100)' : '(رقم صحيح موجب)'}
              </label>
              <input
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                inputMode="numeric"
                dir="ltr"
                className="input-field text-left"
              />
            </div>
            <div>
              <div className="flex justify-between">
                <label className={labelClass}>العنوان</label>
                <span className={`text-[11px] ${form.title.trim().length > TITLE_MAX ? 'text-coral-dark font-bold' : 'text-muted'}`}>
                  {form.title.trim().length}/{TITLE_MAX}
                </span>
              </div>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} dir="auto" className="input-field" />
            </div>
            <div>
              <div className="flex justify-between">
                <label className={labelClass}>الوصف (اختياري)</label>
                <span className={`text-[11px] ${form.description.trim().length > DESCRIPTION_MAX ? 'text-coral-dark font-bold' : 'text-muted'}`}>
                  {form.description.trim().length}/{DESCRIPTION_MAX}
                </span>
              </div>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} dir="auto" className="input-field" />
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer mb-4">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="w-5 h-5 accent-coral"
            />
            <span className="text-sm font-semibold">القفل مفعّل (لو مطفي الميزة بتفضل مفتوحة للجميع)</span>
          </label>

          <p className="text-xs text-muted font-semibold mb-1">الطالب هيشوف:</p>
          <div className="bg-parchment/60 rounded-lg p-3 text-sm mb-4 break-words" dir="auto" data-testid="form-preview">
            {formPreview ?? <span className="text-muted">اختار نوع الشرط وحط القيمة عشان تظهر المعاينة</span>}
          </div>

          {formErrors.length > 0 && (
            <ul className="text-sm text-coral-dark font-semibold list-disc pr-5 mb-4" role="alert">
              {formErrors.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}

          <div className="flex gap-3">
            <button onClick={submitForm} className="btn-primary">{form.mode === 'add' ? 'إضافة للقايمة' : 'تطبيق التعديل'}</button>
            <button onClick={() => { setForm(null); setFormErrors([]); }} className="btn-ghost">إلغاء</button>
          </div>
        </div>
      )}

      {/* الجدول */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="input-field md:w-52" aria-label="فلتر النوع">
          <option value="">كل الأنواع</option>
          {KIND_OPTIONS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        {kindFilter && <span className="text-xs text-muted">تغيير الترتيب مقفول وفيه فلتر — الغِ الفلتر الأول</span>}
      </div>

      {items.length === 0 ? (
        <EmptyState icon="🔒" title="مفيش قواعد قفل لسه" hint="كل المميزات مفتوحة للجميع. دوس إضافة قاعدة لو عايز تقفل ميزة بشرط." />
      ) : rows.length === 0 ? (
        <EmptyState icon="◇" title="مفيش قواعد من النوع ده" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-parchment/60 text-xs text-muted">
              <tr>
                <th className="p-3 text-right w-10">#</th>
                <th className="p-3 text-right">الميزة</th>
                <th className="p-3 text-right">النوع</th>
                <th className="p-3 text-right">الشرط</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, index }) => {
                const feature = getFeature(item?.feature_id);
                const rowProblems = problems.get(index);
                const preview = previewText(item ?? {});
                return (
                  <tr key={`${item?.feature_id}-${index}`} className={`border-t border-parchment-line/60 align-top ${rowProblems ? 'bg-coral/10' : ''}`}>
                    <td className="p-3 text-muted">{index + 1}</td>
                    <td className="p-3">
                      <p className="font-semibold">{feature?.label ?? <span className="text-coral-dark">غير موجودة في القايمة</span>}</p>
                      <p className="text-[11px] text-muted" dir="ltr">{item?.feature_id}</p>
                      {preview && <p className="text-xs text-muted mt-1 break-words" dir="auto">{preview}</p>}
                      {rowProblems && (
                        <p className="text-[11px] text-coral-dark font-semibold mt-1">{rowProblems.join(' — ')}</p>
                      )}
                    </td>
                    <td className="p-3">{getKindLabel(item?.kind)}</td>
                    <td className="p-3">{describeCondition(item?.condition)}</td>
                    <td className="p-3">
                      <button
                        onClick={() => toggleEnabled(index)}
                        aria-pressed={item?.enabled === true}
                        title="دوس عشان تغيّر الحالة"
                      >
                        <Stamp tone={item?.enabled === true ? 'forest' : 'ink'}>
                          {item?.enabled === true ? 'مفعّلة' : 'معطّلة'}
                        </Stamp>
                      </button>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => move(index, -1)}
                          disabled={!!kindFilter || index === 0}
                          className="px-2 py-1 text-muted hover:text-ink disabled:opacity-30"
                          aria-label="تحريك لأعلى"
                        >↑</button>
                        <button
                          onClick={() => move(index, 1)}
                          disabled={!!kindFilter || index === items.length - 1}
                          className="px-2 py-1 text-muted hover:text-ink disabled:opacity-30"
                          aria-label="تحريك لأسفل"
                        >↓</button>
                        <button
                          onClick={() => openEdit(item)}
                          disabled={!!form}
                          className="px-2 py-1 text-muted hover:text-ink disabled:opacity-30"
                          aria-label="تعديل"
                          title={!feature ? 'الميزة مش في الكتالوج — اختار ميزة بديلة أو امسح القاعدة' : ''}
                        >✎</button>
                        <button
                          onClick={() => remove(index)}
                          className="px-2 py-1 text-muted hover:text-coral font-bold"
                          aria-label="حذف"
                        >×</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
