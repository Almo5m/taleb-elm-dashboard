import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, Stamp, EmptyState, CopyButton, useToast, useConfirm } from '../components/UI';
import { useAppUser } from '../context/AppUser';
import { logAction } from '../lib/audit';
import { exportToCsv } from '../lib/csv';

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
    const { data, error } = await supabase
      .from('forum_reports')
      .select('*, forum_threads(title, body, author_id, author_name), forum_replies(body, author_id, author_name)')
      .eq('status', tab)
      .order('created_at', { ascending: false });
    if (error) toast('تعذّر تحميل البلاغات', 'error', error);
    setReports(data || []);
    setLoading(false);
  };

  const markReviewed = async (id) => {
    const { error } = await supabase.from('forum_reports').update({ status: 'reviewed' }).eq('id', id);
    if (error) { toast('تعذّر تحويل البلاغ للمراجَعة', 'error', error); return; }
    setReports((prev) => prev.filter((r) => r.id !== id));
    toast('تم تحويل البلاغ إلى المراجَعة');
  };

  const restoreToPending = async (id) => {
    const { error } = await supabase.from('forum_reports').update({ status: 'pending' }).eq('id', id);
    if (error) { toast('تعذّر إرجاع البلاغ للمعلّقة', 'error', error); return; }
    setReports((prev) => prev.filter((r) => r.id !== id));
    toast('تم إرجاع البلاغ للمعلّقة');
  };

  const deleteReport = async (id) => {
    const ok = await confirm('هيتحذف البلاغ نهائيًا من السجل، متأكد؟', { danger: true, confirmLabel: 'حذف نهائي' });
    if (!ok) return;
    const { error } = await supabase.from('forum_reports').delete().eq('id', id);
    if (error) { toast('تعذّر حذف البلاغ', 'error', error); return; }
    setReports((prev) => prev.filter((r) => r.id !== id));
    toast('تم حذف البلاغ');
  };

  const banAuthor = async (report) => {
    const author = report.thread_id ? report.forum_threads : report.forum_replies;
    if (!author?.author_id) { toast('تعذّر تحديد صاحب المحتوى — يمكن يكون الحساب محذوف', 'error'); return; }
    const ok = await confirm(`هل تريد حظر "${author.author_name || 'الحساب'}"؟ لن يقدر يدخل التطبيق بعدها.`, { danger: true, confirmLabel: 'حظر الحساب' });
    if (!ok) return;
    const { error } = await supabase.from('profiles').update({ banned: true }).eq('id', author.author_id);
    if (error) { toast('تعذّر حظر الحساب', 'error', error); return; }
    logAction({ adminId: me?.id, adminName: me?.name || 'مشرف', action: 'ban', targetType: 'profile', targetId: author.author_id, details: `حظر ${author.author_name || author.author_id} من صفحة البلاغات` });
    toast('تم حظر الحساب');
  };

  const deleteReportedContent = async (report) => {
    const ok = await confirm('هيتحذف المحتوى المبلّغ عنه نهائيًا، متأكد؟', { danger: true, confirmLabel: 'حذف المحتوى' });
    if (!ok) return;
    if (report.thread_id || report.reply_id) {
      const table = report.thread_id ? 'forum_threads' : 'forum_replies';
      const contentId = report.thread_id || report.reply_id;
      const { error: delError } = await supabase.from(table).delete().eq('id', contentId);
      if (delError) { toast('تعذّر حذف المحتوى المبلّغ عنه', 'error', delError); return; }
    }
    const { error: markError } = await supabase.from('forum_reports').update({ status: 'reviewed' }).eq('id', report.id);
    if (markError) { toast('اتحذف المحتوى لكن تعذّر تحويل البلاغ للمراجَعة', 'error', markError); return; }
    setReports((prev) => prev.filter((r) => r.id !== report.id));
    logAction({ adminId: me?.id, adminName: me?.name || 'مشرف', action: 'delete_report_content', targetType: 'report', targetId: report.id, details: `حذف محتوى بلاغ: ${report.reason}` });
    toast('تم حذف المحتوى وتحويل البلاغ للمراجَعة');
  };

  const exportReports = () => {
    const flat = reports.map((r) => {
      const target = r.thread_id ? r.forum_threads : r.forum_replies;
      return {
        created_at: new Date(r.created_at).toLocaleString('ar-EG'),
        reason: r.reason,
        type: r.thread_id ? 'سؤال' : 'رد',
        author_name: target?.author_name || 'مستخدم محذوف',
        content: r.thread_id ? (target?.title || 'محتوى محذوف') : (target?.body || 'محتوى محذوف'),
        status: tab === 'pending' ? 'معلّق' : 'تمت المراجعة',
      };
    });
    exportToCsv(
      `بلاغات-${tab === 'pending' ? 'معلقة' : 'تمت-مراجعتها'}.csv`,
      flat,
      [
        { key: 'created_at', label: 'التاريخ' },
        { key: 'reason', label: 'السبب' },
        { key: 'type', label: 'نوع المحتوى' },
        { key: 'author_name', label: 'صاحب المحتوى' },
        { key: 'content', label: 'المحتوى' },
        { key: 'status', label: 'الحالة' },
      ]
    );
  };

  return (
    <div>
      <PageHeader eyebrow="مراقبة المنتدى" title="البلاغات" />

      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div className="flex gap-2">
          {[
            { key: 'pending', label: 'معلّقة' },
            { key: 'reviewed', label: 'تمت المراجعة' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold border-2 transition ${
                tab === t.key ? 'bg-ink text-surface border-ink' : 'border-surface-line text-muted hover:border-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button onClick={exportReports} disabled={reports.length === 0} className="btn-primary !px-4 !py-2 text-xs">
          تصدير CSV
        </button>
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
              <p className="text-sm text-muted bg-surface rounded-xl p-3">
                {r.thread_id ? (r.forum_threads?.title || 'محتوى محذوف') : (r.forum_replies?.body || 'محتوى محذوف')}
              </p>
              <div className="flex gap-2 mt-3 flex-wrap">
                {tab === 'pending' ? (
                  <>
                    <button onClick={() => deleteReportedContent(r)} className="btn-danger !px-4 !py-2 text-xs">حذف المحتوى المبلّغ عنه</button>
                    <button onClick={() => banAuthor(r)} className="btn-danger !px-4 !py-2 text-xs">حظر الكاتب</button>
                    <button onClick={() => markReviewed(r.id)} className="btn-ghost !px-4 !py-2 text-xs">تمت المراجعة بدون حذف</button>
                    <CopyButton text={() => (r.thread_id ? `${r.forum_threads?.title || ''}\n${r.forum_threads?.body || ''}` : r.forum_replies?.body || '').trim()} label="نسخ المحتوى" className="btn-ghost !px-4 !py-2 text-xs" />
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
