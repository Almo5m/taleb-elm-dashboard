import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { EmptyState, Spinner, Stamp, useToast } from '../UI';
import { ROLE_STAMP, buildReplyFeed, formatCairoDateTime, uniqueValues } from '../../lib/forum';

const FEED_SIZE = 50;

// آخر الردود في المنتدى كلها في مكان واحد: مين رد، على أنهي سؤال، ومين صاحب السؤال.
// الضغط على الرد بيفتح السؤال في قايمة المواضيع.
export default function ReplyFeed({ onOpenThread }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: replies, error } = await supabase
      .from('forum_replies')
      .select('id, thread_id, author_id, author_name, body, created_at')
      .order('created_at', { ascending: false })
      .limit(FEED_SIZE);
    if (error) { toast('تعذّر تحميل آخر الردود', 'error', error); setLoading(false); return; }

    const threadIds = uniqueValues(replies, 'thread_id');
    const authorIds = uniqueValues(replies, 'author_id');
    const [threadRes, roleRes] = await Promise.all([
      threadIds.length ? supabase.from('forum_threads').select('id, title, author_name, author_id').in('id', threadIds) : { data: [] },
      authorIds.length ? supabase.from('profiles').select('id, role').in('id', authorIds) : { data: [] },
    ]);
    // فشل جلب العناوين أو الأدوار مبيوقفش الفيد: بيظهر الرد من غير تفاصيل السؤال
    if (threadRes.error || roleRes.error) toast('بعض تفاصيل الردود ماتحمّلتش', 'error', threadRes.error || roleRes.error);
    const roles = Object.fromEntries((roleRes.data || []).map((p) => [p.id, p.role]));
    setItems(buildReplyFeed(replies, threadRes.data, roles));
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Spinner />;
  if (items.length === 0) return <EmptyState icon="◈" title="مفيش ردود لسه" />;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted">آخر {items.length} رد، الأحدث فوق</p>
        <button type="button" onClick={load} className="btn-ghost !px-3 !py-1.5 text-xs">تحديث</button>
      </div>
      <ul className="space-y-3">
        {items.map((r) => {
          const role = ROLE_STAMP[r.role];
          return (
            <li key={r.id} className="card p-4">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                {r.authorId ? (
                  <Link to={`/accounts/${r.authorId}`} className="font-semibold text-sm hover:underline">{r.authorName}</Link>
                ) : (
                  <span className="font-semibold text-sm">{r.authorName}</span>
                )}
                {role && <Stamp tone={role[0]}>{role[1]}</Stamp>}
                <span className="text-xs text-muted">{formatCairoDateTime(r.createdAt)}</span>
              </div>
              <p className="text-sm whitespace-pre-wrap break-words" dir="auto">{r.body}</p>
              <button
                type="button"
                onClick={() => onOpenThread(r.threadId)}
                className="mt-2.5 w-full text-right bg-surface rounded-xl px-3 py-2 hover:bg-surface-line/50 transition"
              >
                <span className="block text-[11px] text-muted font-semibold">رد على سؤال{r.askerName ? ` ${r.askerName}` : ''}</span>
                <span className="block text-sm truncate">{r.threadTitle || 'السؤال اتمسح'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
