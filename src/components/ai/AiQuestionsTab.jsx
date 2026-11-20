import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { EmptyState, Spinner, Stamp, useToast } from '../UI';
import { uniqueValues, formatCairoDateTime } from '../../lib/forum';
import { CATEGORIES, QUESTION_PAGE_SIZE, categoryTone, cleanSearch, isLongQuestion, studentName } from '../../lib/aiQuestions';

// أسئلة الطلاب لبو بنصها الكامل، مع بحث وتصنيف وفلتر بطالب معيّن (?student=).
// بيتسجّل سؤال الطالب بس (مش رد بو) وبيتمسح تلقائيًا بعد ٦٠ يوم.
export default function AiQuestionsTab() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const studentId = params.get('student');
  const [rows, setRows] = useState([]);
  const [names, setNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [category, setCategory] = useState('الكل');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(new Set());

  // البحث بيتأخر ٣٠٠ms بعد آخر حرف عشان مانبعتش طلب مع كل ضغطة
  useEffect(() => {
    const t = setTimeout(() => setSearch(cleanSearch(searchInput)), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchPage = useCallback(async (from) => {
    let query = supabase
      .from('ai_chat_logs')
      .select('id, user_id, question, category, created_at')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + QUESTION_PAGE_SIZE - 1);
    if (studentId) query = query.eq('user_id', studentId);
    if (category === 'غير مصنّف') query = query.is('category', null);
    else if (category !== 'الكل') query = query.eq('category', category);
    if (search) query = query.ilike('question', `%${search}%`);
    return query;
  }, [studentId, category, search]);

  const loadNames = useCallback(async (data) => {
    const ids = uniqueValues(data, 'user_id');
    if (ids.length === 0) return;
    const { data: profiles } = await supabase.from('profiles').select('id, name').in('id', ids);
    setNames((prev) => ({ ...prev, ...Object.fromEntries((profiles || []).map((p) => [p.id, p.name])) }));
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setExpanded(new Set());
      const { data, error } = await fetchPage(0);
      if (!active) return;
      if (error) { toast('تعذّر تحميل أسئلة الطلاب', 'error', error); setRows([]); setHasMore(false); setLoading(false); return; }
      setRows(data || []);
      setHasMore((data || []).length === QUESTION_PAGE_SIZE);
      await loadNames(data);
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [fetchPage, loadNames, toast]);

  const loadMore = async () => {
    setLoadingMore(true);
    const { data, error } = await fetchPage(rows.length);
    setLoadingMore(false);
    if (error) { toast('تعذّر تحميل المزيد', 'error', error); return; }
    setRows((prev) => [...prev, ...(data || [])]);
    setHasMore((data || []).length === QUESTION_PAGE_SIZE);
    loadNames(data);
  };

  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const clearStudent = () => {
    const next = new URLSearchParams(params);
    next.delete('student');
    setParams(next, { replace: true });
  };

  return (
    <div>
      <p className="text-xs text-muted mb-4 max-w-2xl">
        نص سؤال الطالب كامل زي ما اتبعت. بيتسجّل السؤال بس (مش رد بو)، وبيتمسح تلقائيًا بعد ٦٠ يوم.
        الأسئلة اللي اتحظرت أو فشلت بتظهر هنا برضو.
      </p>

      <div className="card p-4 mb-4 flex flex-col md:flex-row md:flex-wrap gap-3">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="ابحث في نص الأسئلة"
          aria-label="بحث في نص الأسئلة"
          className="input-field md:flex-1 md:min-w-[14rem]"
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="input-field md:w-48" aria-label="التصنيف">
          {['الكل', ...CATEGORIES].map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>

      {studentId && (
        <div className="flex items-center gap-3 mb-4 bg-surface rounded-xl px-3 py-2 w-fit max-w-full">
          <p className="text-sm min-w-0 truncate">أسئلة طالب واحد: <span className="font-semibold">{studentName(names, studentId)}</span></p>
          <button type="button" onClick={clearStudent} className="btn-ghost !px-3 !py-1 text-xs shrink-0">كل الطلاب</button>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="◇" title="مفيش أسئلة مطابقة" hint={search || category !== 'الكل' || studentId ? 'جرّب تغيّر البحث أو الفلتر' : undefined} />
      ) : (
        <>
          <ul className="space-y-3">
            {rows.map((q) => {
              const long = isLongQuestion(q.question);
              const open = expanded.has(q.id);
              return (
                <li key={q.id} className="card p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <Link to={`/accounts/${q.user_id}`} className="font-semibold text-sm hover:underline">{studentName(names, q.user_id)}</Link>
                    <Stamp tone={categoryTone(q.category)}>{q.category || 'غير مصنّف'}</Stamp>
                    <span className="text-xs text-muted">{formatCairoDateTime(q.created_at)}</span>
                  </div>
                  <p className={`text-sm whitespace-pre-wrap break-words ${long && !open ? 'line-clamp-4' : ''}`} dir="auto">{q.question}</p>
                  {long && (
                    <button type="button" onClick={() => toggle(q.id)} className="text-xs font-semibold text-accent-dark mt-1.5 hover:underline">
                      {open ? 'إخفاء' : 'عرض السؤال كامل'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {hasMore && (
            <button type="button" onClick={loadMore} disabled={loadingMore} className="btn-ghost mt-4">
              {loadingMore ? 'جارِ التحميل...' : 'عرض المزيد'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
