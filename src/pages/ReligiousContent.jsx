import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, EmptyState, useToast, useConfirm } from '../components/UI';

export default function ReligiousContent() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // بند بيتعدّل دلوقتي، أو null
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('religious_collections').select('*').order('kind').order('sort_order');
    if (error) toast('تعذّر تحميل المحتوى', 'error', error);
    setItems(data || []);
    setLoading(false);
  };

  // كل بند (فئة أذكار أو قايمة أدعية) عنده مصفوفة items جوّاه [{text, count, note}]
  // — بتتعدّل واحدة واحدة من حقول عادية (نص، رقم تكرار، ملاحظة)، مفيش أي JSON
  const saveItems = async (id, itemsArray) => {
    const { error } = await supabase.from('religious_collections').update({ items: itemsArray }).eq('id', id);
    if (error) { toast('تعذّر الحفظ', 'error', error); return; }
    toast('تم الحفظ');
    setEditingId(null);
    load();
  };

  const remove = async (id) => {
    const ok = await confirm('هتحذف الفئة/القايمة دي، متأكد؟', { danger: true, confirmLabel: 'حذف' });
    if (!ok) return;
    const { error } = await supabase.from('religious_collections').delete().eq('id', id);
    if (error) { toast('تعذّر الحذف', 'error', error); return; }
    setItems((prev) => prev.filter((i) => i.id !== id));
    toast('تم الحذف');
  };

  const azkarCats = items.filter((i) => i.kind === 'azkar_category');
  const duaLists = items.filter((i) => i.kind === 'dua_list');

  const renderItem = (item) => (
    <div key={item.id} className="card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{item.title} <span className="text-xs text-muted">({item.items.length} بند)</span></p>
        <div className="flex gap-2">
          <button onClick={() => setEditingId(editingId === item.id ? null : item.id)} className="text-xs font-semibold text-primary px-2 py-1">
            {editingId === item.id ? 'إلغاء' : 'تعديل'}
          </button>
          <button onClick={() => remove(item.id)} className="text-xs font-semibold text-muted hover:text-coral px-2 py-1">حذف</button>
        </div>
      </div>
      {editingId === item.id && (
        <ItemsEditor initial={item.items} onSave={(arr) => saveItems(item.id, arr)} />
      )}
    </div>
  );

  return (
    <div>
      <PageHeader eyebrow={`${azkarCats.length} فئة أذكار • ${duaLists.length} قايمة أدعية`} title="الأذكار والأدعية" />

      {loading ? <Spinner /> : (
        <>
          <h3 className="text-sm font-bold text-muted mb-3">فئات الأذكار</h3>
          <div className="space-y-3 max-w-2xl mb-8">
            {azkarCats.length === 0 ? <EmptyState icon="🕌" title="مفيش فئات أذكار" /> : azkarCats.map(renderItem)}
          </div>

          <h3 className="text-sm font-bold text-muted mb-3">قوائم الأدعية</h3>
          <div className="space-y-3 max-w-2xl">
            {duaLists.length === 0 ? <EmptyState icon="🤲" title="مفيش قوائم أدعية" /> : duaLists.map(renderItem)}
          </div>
        </>
      )}
    </div>
  );
}

// محرر بنود ذكر/دعاء — كل بند سطر عادي: نص + عدد التكرار + ملاحظة اختياري.
// مفيش أي JSON، كله حقول عادية بتتعدّل وتتضاف وتتشال بالزرار
function ItemsEditor({ initial, onSave }) {
  const [list, setList] = useState(initial.map((it, i) => ({ ...it, _key: i })));
  const [nextKey, setNextKey] = useState(initial.length);
  const [saving, setSaving] = useState(false);

  const updateField = (key, field, value) => {
    setList((prev) => prev.map((it) => (it._key === key ? { ...it, [field]: value } : it)));
  };

  const removeRow = (key) => setList((prev) => prev.filter((it) => it._key !== key));

  const addRow = () => {
    setList((prev) => [...prev, { text: '', count: 1, note: '', _key: nextKey }]);
    setNextKey((n) => n + 1);
  };

  const moveRow = (key, dir) => {
    setList((prev) => {
      const idx = prev.findIndex((it) => it._key === key);
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      return copy;
    });
  };

  const handleSave = () => {
    const cleaned = list
      .map(({ _key, ...rest }) => ({
        text: (rest.text || '').trim(),
        count: Number(rest.count) > 0 ? Number(rest.count) : 1,
        note: (rest.note || '').trim() || null,
      }))
      .filter((it) => it.text);
    if (cleaned.length === 0) {
      onSave(cleaned); // سيبها تحفظ فاضية لو عايز يمسح كل البنود عمدًا
      return;
    }
    setSaving(true);
    onSave(cleaned);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {list.map((it, idx) => (
          <div key={it._key} className="bg-surface rounded-xl p-3 space-y-2">
            <textarea
              value={it.text}
              onChange={(e) => updateField(it._key, 'text', e.target.value)}
              placeholder="نص الذكر أو الدعاء"
              rows={2}
              className="input-field w-full text-sm"
            />
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted font-semibold shrink-0">عدد التكرار</label>
              <input
                type="number"
                min={1}
                value={it.count ?? 1}
                onChange={(e) => updateField(it._key, 'count', e.target.value)}
                className="input-field w-20 text-sm"
              />
              <input
                value={it.note || ''}
                onChange={(e) => updateField(it._key, 'note', e.target.value)}
                placeholder="ملاحظة (اختياري، زي: آية الكرسي)"
                className="input-field flex-1 text-sm"
              />
            </div>
            <div className="flex items-center justify-end gap-1">
              <button onClick={() => moveRow(it._key, -1)} disabled={idx === 0} className="text-xs text-muted disabled:opacity-30 px-2 py-1">↑</button>
              <button onClick={() => moveRow(it._key, 1)} disabled={idx === list.length - 1} className="text-xs text-muted disabled:opacity-30 px-2 py-1">↓</button>
              <button onClick={() => removeRow(it._key)} className="text-xs font-semibold text-muted hover:text-coral px-2 py-1">حذف البند</button>
            </div>
          </div>
        ))}
      </div>

      <button onClick={addRow} className="btn-ghost text-sm w-full">+ ضيف بند جديد</button>

      <button onClick={handleSave} disabled={saving} className="btn-primary text-sm w-full">
        {saving ? 'جارِ الحفظ...' : 'حفظ التعديلات'}
      </button>
    </div>
  );
}