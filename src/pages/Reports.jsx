import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, EmptyState, useToast, useConfirm } from '../components/UI';
import { useAppUser } from '../context/AppUser';
import { logAction } from '../lib/audit';

export default function Reports() {
  const [reports, setReports] = useState([]);
  const [tab, setTab] = useState('pending'); // pending | reviewed
  const [loading, setLoading] = useState(true);
  const toast = useToast();
  const confirm = useConfirm();
  const me = useAppUser();

  useEffect(() => {
    load();
  }, [tab]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('forum_reports')
      .select('*, forum_threads(title, body, author_id, author_name), forum_replies(body, author_id, author_name)')
      .eq('status', tab)
      .order('created_at', { ascending: false });
    setReports(data || []);
    setLoading(false);
  };

  const markReviewed = async (id) => {
    await supabase.from('forum_reports').update({ status: 'reviewed' }).eq('id', id);
    setReports((prev) => prev.filter((r) => r.id !== id));
    toast('تم تحويل البلاغ إلى المراجَعة');
  };

  const restoreToPending = async (id) => {
    await supabase.from('forum_reports').update({ status: 'pending' }).eq('id', id);
    setReports((prev) => prev.filter((r) => r.id !== id));
    toast('تم إرجاع البلاغ للمعلّقة');
  };

  const deleteReport = async (id) => {
    const ok = await confirm('هيتحذف البلاغ نهائيًا من السجل، متأكد؟', { danger: true, confirmLabel: 'حذف نهائي' });
    if (!ok) return;
    await supabase.from('forum_reports').delete().eq('id', id);
    setReports((prev) => prev.filter((r) => r.id !== id));
    toast('تم حذف البلاغ');
  };

  const banAuthor = async (report) => {
    const author = report.thread_id ? report.forum_threads : report.forum_replies;
    if (!author?.author_id) { toast('تعذّر تحديد صاحب المحتوى — يمكن يكون الحساب محذوف', 'error'); return; }
    const ok = await confirm(`هل تريد حظر "${author.author_name || 'الحساب'}"؟ لن يقدر يدخل التطبيق بعدها.`, { danger: true, confirmLabel: 'حظر الحساب' });
    if (!ok) return;
    const { error } = await supabase.from('profiles').update({ banned: true }).eq('id', author.author_id);
    if (error) { toast('تعذّر حظر الحساب', 'error'); return; }
    logAction({ adminId: me?.id, adminName: me?.name || 'مشرف', action: 'ban', targetType: 'profile', targetId: author.author_id, details: `حظر ${author.author_name || author.author_id} من صفحة البلاغات` });
    toast('تم حظر الحساب');
  };

  const deleteReportedContent = async (report) => {
    const ok = await confirm('هيتحذف المحتوى المبلّغ عنه نهائيًا، متأكد؟', { danger: true, confirmLabel: 'حذف المحتوى' });
    if (!ok) return;
    if (report.thread_id) {
      await supabase.from('forum_threads').delete().eq('id', report.thread_id);
    } else if (report.reply_id) {
      await supabase.from('forum_replies').delete().eq('id', report.reply_id);
    }
    await supabase.from('forum_reports').update({ status: 'reviewed' }).eq('id', report.id);
    setReports((prev) => prev.filter((r) => r.id !== report.id));
    logAction({ adminId: me?.id, adminName: me?.name || 'مشرف', action: 'delete_report_content', targetType: 'report', targetId: report.id, details: `حذف محتوى بلاغ: ${report.reason}` });
    toast('تم حذف المحتوى وتحويل البلاغ للمراجَعة');
  };

  return (
    <div>
      <PageHeader eyebrow="مراقبة المنتدى" title="البلاغات" />

      <div className="flex gap-2 mb-6">
        {[
          { key: 'pending', label: 'معلّقة' },
          { key: 'reviewed', label: 'تمت المراجعة' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition ${
              tab === t.key ? 'bg-ink text-parchment border-ink' : 'border-parchment-line text-muted hover:border-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : reports.length === 0 ? (
        <EmptyState icon="⚑" title={tab === 'pending' ? 'مفيش بلاغات معلّقة 🎉' : 'مفيش بلاغات تمت مراجعتها بعد'} />
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r.id} className="card p-4">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <Stamp tone={tab === 'pending' ? 'coral' : 'forest'}>{r.reason}</Stamp>
                <span className="text-xs text-muted">{new Date(r.created_at).toLocaleDateString('ar-EG')}</span>
              </div>
              <p className="text-sm font-semibold mb-1">
                {r.thread_id ? 'بلاغ عن سؤال' : 'بلاغ عن رد'}
                {' '}بواسطة{' '}
                <span className="text-inktext">{(r.thread_id ? r.forum_threads?.author_name : r.forum_replies?.author_name) || 'مستخدم محذوف'}</span>
              </p>
              <p className="text-sm text-muted bg-parchment rounded-xl p-3">
                {r.thread_id ? (r.forum_threads?.title || 'محتوى محذوف') : (r.forum_replies?.body || 'محتوى محذوف')}
              </p>
              <div className="flex gap-2 mt-3 flex-wrap">
                {tab === 'pending' ? (
                  <>
                    <button onClick={() => deleteReportedContent(r)} className="btn-danger !px-4 !py-2 text-xs">حذف المحتوى المبلّغ عنه</button>
                    <button onClick={() => banAuthor(r)} className="btn-danger !px-4 !py-2 text-xs">حظر الكاتب</button>
                    <button onClick={() => markReviewed(r.id)} className="btn-ghost !px-4 !py-2 text-xs">تمت المراجعة بدون حذف</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => restoreToPending(r.id)} className="btn-ghost !px-4 !py-2 text-xs">إرجاع للمعلّقة</button>
                    <button onClick={() => deleteReport(r.id)} className="btn-danger !px-4 !py-2 text-xs">حذف من السجل</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
