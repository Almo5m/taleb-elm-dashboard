import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, EmptyState, useToast, useConfirm } from '../components/UI';
import { useAppUser } from '../context/AppUser';
import { logAction } from '../lib/audit';
import { fetchAll, inChunks } from '../lib/fetchAll';

export default function Forum() {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [gradeFilter, setGradeFilter] = useState('الكل');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [replies, setReplies] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [replyDrafts, setReplyDrafts] = useState({});
  const [sendingReply, setSendingReply] = useState({});
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();

  const grades = ['الكل', 'الصف الأول الثانوي', 'الصف الثاني الثانوي', 'الصف الثالث الثانوي'];

  useEffect(() => {
    loadThreads();
  }, []);

  const loadThreads = async () => {
    setLoading(true);
    // fetchAll: Supabase بيقطع الاستعلام عند 1000 صف، والبحث هنا بيتم على كل الأسئلة
    const { data, error } = await fetchAll(() => supabase.from('forum_threads').select('*').order('created_at', { ascending: false }).order('id'));
    if (error) toast('تعذّر تحميل كل الأسئلة — اللي ظاهر ممكن يكون ناقص', 'error', error);
    setThreads(data || []);
    setLoading(false);
  };

  const audit = (action, targetId, details) =>
    logAction({ adminId: me?.id, adminName: me?.name || 'مشرف', action, targetType: 'thread', targetId, details });

  const toggleExpand = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!replies[id]) {
      const { data, error } = await supabase.from('forum_replies').select('*').eq('thread_id', id).order('created_at');
      if (error) toast('تعذّر تحميل الردود', 'error', error);
      setReplies((prev) => ({ ...prev, [id]: data || [] }));
    }
  };

  const deleteThread = async (t) => {
    const ok = await confirm('هتحذف السؤال ده وكل الردود عليه، متأكد؟', { danger: true, confirmLabel: 'حذف السؤال' });
    if (!ok) return;
    const { error } = await supabase.from('forum_threads').delete().eq('id', t.id);
    if (error) { toast('تعذّر حذف السؤال', 'error', error); return; }
    setThreads((prev) => prev.filter((x) => x.id !== t.id));
    audit('delete_thread', t.id, `حذف سؤال: ${t.title}`);
    toast('تم حذف السؤال');
  };

  const deleteReply = async (threadId, replyId) => {
    const ok = await confirm('هتحذف الرد ده، متأكد؟', { danger: true, confirmLabel: 'حذف الرد' });
    if (!ok) return;
    const { error } = await supabase.from('forum_replies').delete().eq('id', replyId);
    if (error) { toast('تعذّر حذف الرد', 'error', error); return; }
    setReplies((prev) => ({ ...prev, [threadId]: prev[threadId].filter((r) => r.id !== replyId) }));
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, replies_count: Math.max(0, t.replies_count - 1) } : t)));
    logAction({ adminId: me?.id, adminName: me?.name || 'مشرف', action: 'delete_reply', targetType: 'reply', targetId: replyId, details: 'حذف رد من سؤال' });
    toast('تم حذف الرد');
  };

  const addReply = async (threadId) => {
    const body = (replyDrafts[threadId] || '').trim();
    if (!body) return;
    setSendingReply((prev) => ({ ...prev, [threadId]: true }));
    const { data, error } = await supabase
      .from('forum_replies')
      .insert({ thread_id: threadId, author_id: me?.id, author_name: me?.name || 'الإدارة', body })
      .select()
      .single();
    setSendingReply((prev) => ({ ...prev, [threadId]: false }));
    if (error) { toast('تعذّر إرسال الرد', 'error', error); return; }
    setReplies((prev) => ({ ...prev, [threadId]: [...(prev[threadId] || []), data] }));
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, replies_count: t.replies_count + 1 } : t)));
    setReplyDrafts((prev) => ({ ...prev, [threadId]: '' }));
    logAction({ adminId: me?.id, adminName: me?.name || 'مشرف', action: 'admin_reply', targetType: 'thread', targetId: threadId, details: 'رد إداري على سؤال في المنتدى' });
    toast('تم إرسال الرد');
  };

  const filtered = useMemo(() => {
    return threads
      .filter((t) => gradeFilter === 'الكل' || t.grade === gradeFilter)
      .filter((t) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q) || (t.author_name || '').toLowerCase().includes(q);
      });
  }, [threads, gradeFilter, search]);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bulkDelete = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await confirm(`هتحذف ${ids.length} سؤال وكل الردود عليهم، متأكد؟`, { danger: true, confirmLabel: `حذف ${ids.length} سؤال` });
    if (!ok) return;
    const { error, done } = await inChunks(ids, (part) => supabase.from('forum_threads').delete().in('id', part));
    if (error) {
      toast(`الحذف الجماعي وقف بعد ${done} من ${ids.length} سؤال — اللي قبل كده اتحذف`, 'error', error);
      loadThreads();
      return;
    }
    setThreads((prev) => prev.filter((t) => !ids.includes(t.id)));
    audit('bulk_delete_threads', null, `حذف جماعي لـ ${ids.length} سؤال`);
    toast(`تم حذف ${ids.length} سؤال`);
    setSelected(new Set());
  };

  return (
    <div>
      <PageHeader eyebrow={`${threads.length} سؤال في المنتدى`} title="إدارة المنتدى" />

      <div className="card p-4 mb-4 flex flex-col md:flex-row md:flex-wrap gap-3">
        <input
          placeholder="ابحث في العناوين والأسئلة"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field md:flex-1 md:min-w-[16rem]"
        />
        <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} className="input-field md:w-56">
          {grades.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between mb-4 card !p-3 bg-coral/5 border-coral/30">
          <span className="text-sm font-semibold">{selected.size} سؤال محدَّد</span>
          <div className="flex gap-2">
            <button onClick={() => setSelected(new Set())} className="btn-ghost !px-3 !py-1.5 text-xs">إلغاء التحديد</button>
            <button onClick={bulkDelete} className="btn-danger !px-3 !py-1.5 text-xs">حذف المحدَّد</button>
          </div>
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon="◈" title="مفيش مواضيع مطابقة" />
      ) : (
        <div className="space-y-3">
          {filtered.map((t) => (
            <div key={t.id} className="card overflow-hidden">
              <div className="p-4 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <input
                    type="checkbox"
                    checked={selected.has(t.id)}
                    onChange={() => toggleSelect(t.id)}
                    className="w-4 h-4 accent-ink mt-1.5 shrink-0"
                  />
                  <div className="flex-1 cursor-pointer min-w-0" onClick={() => toggleExpand(t.id)}>
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <Stamp tone="ink">{t.grade}</Stamp>
                      {t.track && <span className="text-xs border border-surface-line px-2 py-0.5 rounded-lg text-muted">{t.track}</span>}
                      {t.subject_name && <span className="text-xs bg-ink text-surface px-2 py-0.5 rounded-lg">{t.subject_name}</span>}
                    </div>
                    <h3 className="font-bold">{t.title}</h3>
                    <p className="text-sm text-muted mt-1 line-clamp-2">{t.body}</p>
                    <p className="text-xs text-muted mt-2">
                      {t.author_name} • {new Date(t.created_at).toLocaleDateString('ar-EG')} • {t.replies_count} رد
                    </p>
                  </div>
                </div>
                <button onClick={() => deleteThread(t)} className="btn-danger !px-3 !py-1.5 text-xs whitespace-nowrap shrink-0">
                  حذف السؤال
                </button>
              </div>

              {expandedId === t.id && (
                <div className="border-t border-surface-line bg-surface p-4 space-y-2">
                  {!replies[t.id] || replies[t.id].length === 0 ? (
                    <p className="text-sm text-muted">مفيش ردود</p>
                  ) : (
                    replies[t.id].map((r) => (
                      <div key={r.id} className="bg-surface-card border border-surface-line rounded-xl p-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{r.author_name}</p>
                          <p className="text-sm text-muted">{r.body}</p>
                          <p className="text-xs text-muted mt-1">{new Date(r.created_at).toLocaleDateString('ar-EG')}</p>
                        </div>
                        <button onClick={() => deleteReply(t.id, r.id)} className="text-xs font-semibold text-muted hover:text-coral px-2 py-1 whitespace-nowrap shrink-0">
                          حذف
                        </button>
                      </div>
                    ))
                  )}
                  <div className="flex gap-2 pt-2">
                    <input
                      value={replyDrafts[t.id] || ''}
                      onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && addReply(t.id)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="اكتب ردك هنا..."
                      className="input-field flex-1"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); addReply(t.id); }}
                      disabled={sendingReply[t.id]}
                      className="btn-primary shrink-0"
                    >
                      {sendingReply[t.id] ? 'جارِ الإرسال...' : 'إرسال رد'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
