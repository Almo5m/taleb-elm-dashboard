import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { PageHeader, Spinner, EmptyState, useToast, useConfirm } from '../components/UI';

// الصفحة دي فيها محتوى حساس، فبنطلب تأكيد إضافي: الأدمن يكتب باسورد حسابه
// هو نفسه (مش سر تاني)، وبنتحقق منها فعليًا عن طريق Supabase Auth
// (signInWithPassword) — يعني مفيش أي كلمة سر مخزّنة أو مكتوبة في الكود
// خالص، والتحقق حقيقي على السيرفر مش مجرد مقارنة نص في المتصفح.
const SESSION_KEY = 'banned_words_unlocked';

function Gate({ onUnlock }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setChecking(true);
    setError(false);

    const { data: sessionData } = await supabase.auth.getSession();
    const email = sessionData?.session?.user?.email;

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password: input });

    if (authError) {
      setError(true);
      setChecking(false);
      return;
    }

    sessionStorage.setItem(SESSION_KEY, '1');
    onUnlock();
  };

  return (
    <div>
      <PageHeader eyebrow="محتوى مقيّد" title="الكلمات الممنوعة" />
      <form onSubmit={submit} className="card p-6 max-w-sm">
        <div className="w-12 h-12 rounded-full bg-ink text-gold flex items-center justify-center text-xl mb-4">🔒</div>
        <p className="font-semibold mb-1">أكّد باسورد حسابك للمتابعة</p>
        <p className="text-sm text-muted mb-4">المحتوى حساس — محتاجين تأكيد إضافي إنك فعلاً صاحب الحساب</p>
        <input
          type="password"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(false); }}
          autoFocus
          className="input-field mb-3"
          placeholder="باسورد حسابك"
        />
        {error && <p className="text-coral-dark text-sm font-semibold mb-3">الباسورد غلط</p>}
        <button type="submit" disabled={checking} className="btn-primary w-full">
          {checking ? 'جارِ التحقق...' : 'تأكيد'}
        </button>
      </form>
    </div>
  );
}

function BannedWordsContent() {
  const [words, setWords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newWord, setNewWord] = useState('');
  const [showTyping, setShowTyping] = useState(false);
  const [revealAll, setRevealAll] = useState(false);
  const [revealedIds, setRevealedIds] = useState(new Set());
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('banned_words').select('*').order('created_at', { ascending: false });
    setWords(data || []);
    setLoading(false);
  };

  const add = async () => {
    const w = newWord.trim();
    if (!w) return;
    const { error } = await supabase.from('banned_words').insert({ word: w });
    if (error) { toast('الكلمة دي مضافة بالفعل أو حصل خطأ', 'error'); return; }
    setNewWord('');
    toast('تمت الإضافة للفلتر');
    load();
  };

  const remove = async (id) => {
    const ok = await confirm('هتشيل الكلمة دي من الفلتر، متأكد؟', { danger: true, confirmLabel: 'حذف' });
    if (!ok) return;
    await supabase.from('banned_words').delete().eq('id', id);
    setWords((prev) => prev.filter((w) => w.id !== id));
    setRevealedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    toast('تم الحذف من الفلتر');
  };

  const toggleReveal = (id) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const lockAgain = () => {
    sessionStorage.removeItem(SESSION_KEY);
    window.location.reload();
  };

  return (
    <div>
      <PageHeader
        eyebrow="حماية استباقية للمنتدى"
        title="الكلمات الممنوعة"
        action={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={revealAll}
                onChange={(e) => setRevealAll(e.target.checked)}
                className="w-4 h-4 accent-ink"
              />
              <span className="text-sm font-semibold text-muted">{revealAll ? 'إخفاء الكل 👁' : 'إظهار الكل 🙈'}</span>
            </label>
            <button onClick={lockAgain} className="text-xs font-semibold text-muted hover:text-coral">🔒 قفل الصفحة</button>
          </div>
        }
      />

      <div className="card p-5 mb-8 max-w-xl bg-gold/10 border-gold/40">
        <p className="text-sm text-inktext leading-relaxed">
          أي سؤال أو رد يحتوي على كلمة من القائمة دي هيترفض تلقائيًا قبل ما ينشر، وهيظهر
          للطالب رسالة توضيحية بدل النشر. الفحص مش حساس لحالة الأحرف (كبير/صغير).
        </p>
        <p className="text-xs text-muted mt-2">
          الكلمات متشوّشة بشكل افتراضي كمان جوه الصفحة نفسها — اضغط على أي كلمة عشان تكشفها لوحدها، أو "إظهار الكل" فوق.
        </p>
      </div>

      <div className="card p-4 mb-8 max-w-xl flex gap-2">
        <input
          type={showTyping ? 'text' : 'password'}
          value={newWord}
          onChange={(e) => setNewWord(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="أضف كلمة ممنوعة"
          className="input-field"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setShowTyping((v) => !v)}
          className="btn-ghost shrink-0 !px-3"
          title={showTyping ? 'إخفاء أثناء الكتابة' : 'إظهار أثناء الكتابة'}
        >
          {showTyping ? '🙈' : '👁'}
        </button>
        <button onClick={add} className="btn-primary shrink-0">إضافة</button>
      </div>

      {loading ? (
        <Spinner />
      ) : words.length === 0 ? (
        <EmptyState icon="⊘" title="القائمة فاضية حاليًا" />
      ) : (
        <div className="flex flex-wrap gap-2 max-w-xl">
          {words.map((w) => {
            const revealed = revealAll || revealedIds.has(w.id);
            return (
              <span
                key={w.id}
                className="inline-flex items-center gap-2 bg-parchment-card border border-parchment-line rounded-full px-3 py-1.5 text-sm"
              >
                <span
                  onClick={() => toggleReveal(w.id)}
                  className="cursor-pointer tracking-widest text-muted hover:text-inktext transition-colors"
                  title={revealed ? 'اضغط للتشويش تاني' : 'اضغط للكشف'}
                >
                  {revealed ? w.word : '•'.repeat(Math.max(w.word.length, 4))}
                </span>
                <button onClick={() => remove(w.id)} className="text-muted hover:text-coral font-bold">×</button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function BannedWords() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1');

  if (!unlocked) return <Gate onUnlock={() => setUnlocked(true)} />;
  return <BannedWordsContent />;
}
