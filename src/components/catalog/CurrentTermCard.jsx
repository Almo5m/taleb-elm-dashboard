import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useToast } from '../UI';
import { useAppUser } from '../../context/AppUser';
import { logAction } from '../../lib/audit';
import { fetchSetting, writeSetting } from '../../lib/appSettings';
import { currentTermOf } from '../../lib/catalogUnits';

const KEY = 'current_term';
const OPTIONS = [
  { term: 1, label: 'الترم الأول' },
  { term: 2, label: 'الترم الثاني' },
  { term: null, label: 'غير محدد' },
];
const labelOf = (term) => OPTIONS.find((o) => o.term === term).label;

// الترم الحالي اللي التطبيق بيفتح عليه (app_settings.current_term). "غير محدد" = مسح الصف، والتطبيق بيفتح على الترم الأول.
export default function CurrentTermCard() {
  const toast = useToast();
  const me = useAppUser();
  const [state, setState] = useState({ loading: true, error: null, term: null });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const result = await fetchSetting(KEY);
    if (result.error) { setState({ loading: false, error: result.error, term: null }); return; }
    setState({ loading: false, error: null, term: currentTermOf(result.value) });
  };

  useEffect(() => { load(); }, []);

  const choose = async (term) => {
    if (saving || term === state.term) return;
    setSaving(true);
    const { error } = term === null
      ? await supabase.from('app_settings').delete().eq('key', KEY)
      : await writeSetting(KEY, { term });
    setSaving(false);
    if (error) { toast('تعذّر تغيير الترم الحالي', 'error', error); return; }
    logAction({
      adminId: me?.id, adminName: me?.name || 'أدمن', action: 'catalog_term_update', targetType: 'app_settings', targetId: KEY,
      details: `الترم الحالي: ${labelOf(state.term)} ← ${labelOf(term)}`,
    });
    toast(`الترم الحالي دلوقتي: ${labelOf(term)}`);
    setState({ loading: false, error: null, term });
  };

  return (
    <div className="card p-4 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-messiri font-bold">الترم الحالي في التطبيق</p>
          <p className="text-xs text-muted">التطبيق بيفتح على تبويب الترم ده. من غير تحديد بيفتح على الترم الأول.</p>
        </div>
        {state.loading ? (
          <span className="text-sm text-muted">بيتحمّل...</span>
        ) : state.error ? (
          <button onClick={load} className="btn-ghost !px-3 !py-1.5 text-xs">تعذّر التحميل، أعد المحاولة</button>
        ) : (
          <div className="flex gap-2" role="radiogroup" aria-label="الترم الحالي">
            {OPTIONS.map((o) => (
              <button
                key={String(o.term)}
                type="button"
                role="radio"
                aria-checked={state.term === o.term}
                disabled={saving}
                onClick={() => choose(o.term)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${state.term === o.term ? 'bg-ink text-accent' : 'bg-white border border-surface-line text-muted hover:text-ink'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted mt-2">قبل ما تحوّل للترم الثاني: ضيف وحداته مخفية، جهّز دروسها، فعّلها، وبعدين غيّر الترم هنا.</p>
    </div>
  );
}
