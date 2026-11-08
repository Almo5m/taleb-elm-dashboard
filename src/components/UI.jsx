import { Component, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { buildErrorReport, copyToClipboard, describeDetails } from '../lib/errors';

/* ============ زرار نسخ + نص قابل للنسخ بضغطة ============ */
export function CopyButton({ text, label = 'نسخ', copiedLabel = 'تم النسخ ✓', className = '' }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const value = typeof text === 'function' ? text() : text;
    const ok = await copyToClipboard(value ?? '');
    setCopied(ok);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button type="button" onClick={onClick} className={className || 'btn-ghost !px-2.5 !py-1 text-xs'}>
      {copied ? copiedLabel : label}
    </button>
  );
}

// بيعرض قيمة (ID، إيميل...) والضغط عليها بينسخها
export function CopyText({ value, children, className = '' }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (value === null || value === undefined || value === '') return <span>{children ?? '—'}</span>;

  const onClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyToClipboard(String(value));
    setCopied(ok);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title="اضغط للنسخ"
      className={`select-text cursor-copy hover:underline decoration-dotted underline-offset-4 ${className}`}
    >
      {children ?? String(value)}
      {copied && <span className="text-forest text-[11px] mr-1.5">✓ اتنسخ</span>}
    </button>
  );
}

/* ============ Toast ============
   toast(رسالة, 'ok' | 'success' | 'error', تفاصيل؟)
   - الأخطاء قابلة للتحديد والنسخ، وفيها زرار "نسخ التفاصيل" (الرسالة + الوقت + الصفحة + تفاصيل الخطأ).
   - خطأ معاه تفاصيل بيفضل ظاهر لحد ما تقفله. خطأ من غير تفاصيل بيفضل 8 ثواني. الباقي 3 ثواني.
   - نفس الخطأ المتكرر بيتجمّع في إشعار واحد بعدّاد (×2).
   - أي خطأ غير متوقع (Promise اتفشل أو استثناء) بيظهر هنا برضه بدل ما يضيع. */
const ToastCtx = createContext(null);

const OK_MS = 3200;
const ERROR_MS = 8000;
const MAX_TOASTS = 6;

const IGNORED_GLOBAL = [/ResizeObserver loop/i, /^Script error\.?$/i];

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const itemsRef = useRef([]);
  const timersRef = useRef({});

  const commit = (next) => {
    itemsRef.current = next;
    setToasts(next);
  };

  const dismiss = useCallback((id) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    commit(itemsRef.current.filter((t) => t.id !== id));
  }, []);

  const schedule = useCallback((id, ms) => {
    clearTimeout(timersRef.current[id]);
    if (ms) timersRef.current[id] = setTimeout(() => dismiss(id), ms);
  }, [dismiss]);

  const push = useCallback((message, variant = 'ok', details) => {
    const isError = variant === 'error';
    const detailsText = isError ? describeDetails(details) : '';
    const key = `${variant}|${message}|${detailsText}`;
    const ms = isError ? (detailsText ? 0 : ERROR_MS) : OK_MS;

    const existing = itemsRef.current.find((t) => t.key === key);
    if (existing) {
      commit(itemsRef.current.map((t) => (t.id === existing.id ? { ...t, count: t.count + 1 } : t)));
      schedule(existing.id, ms);
      return;
    }

    const id = Math.random().toString(36).slice(2);
    const item = {
      id, key, message, variant, count: 1, detailsText,
      report: isError ? buildErrorReport(message, details, detailsText) : '',
    };
    let next = [...itemsRef.current, item];
    while (next.length > MAX_TOASTS) {
      clearTimeout(timersRef.current[next[0].id]);
      next = next.slice(1);
    }
    commit(next);
    schedule(id, ms);
  }, [schedule]);

  // أخطاء غير متوقعة (مش جوه try/catch) تظهر بدل ما تضيع
  useEffect(() => {
    const onRejection = (e) => {
      const reason = e.reason;
      if (reason?.name === 'AbortError') return;
      push('حصل خطأ غير متوقع', 'error', reason ?? 'unhandledrejection (من غير تفاصيل)');
    };
    const onError = (e) => {
      const msg = e.message || '';
      if (IGNORED_GLOBAL.some((re) => re.test(msg))) return;
      if (!e.error && !msg) return;
      const where = e.filename ? `\n${e.filename}:${e.lineno}:${e.colno}` : '';
      push('حصل خطأ غير متوقع', 'error', e.error || `${msg}${where}`);
    };
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, [push]);

  const errorCount = toasts.filter((t) => t.variant === 'error').length;

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center w-full px-4 pointer-events-none">
        {errorCount > 1 && (
          <button
            type="button"
            onClick={() => commit(itemsRef.current.filter((t) => t.variant !== 'error'))}
            className="pointer-events-auto text-xs font-semibold bg-ink text-parchment rounded-full px-3 py-1 shadow-card"
          >
            إغلاق كل الأخطاء ({errorCount})
          </button>
        )}
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({ toast: t, onClose }) {
  const [open, setOpen] = useState(false);
  const isError = t.variant === 'error';
  return (
    <div
      className={`pointer-events-auto animate-riseIn shadow-card border-2 rounded-xl px-4 py-2.5 text-sm font-semibold w-full max-w-xl select-text ${
        isError ? 'bg-coral text-white border-coral' : 'bg-ink text-parchment border-ink'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5">{isError ? '⚑' : '✓'}</span>
        <span className="flex-1 break-words leading-relaxed" dir="auto">
          {t.message}
          {t.count > 1 && <span className="opacity-80 font-normal"> (×{t.count})</span>}
        </span>
        {isError && (
          <button type="button" onClick={onClose} aria-label="إغلاق" className="text-lg leading-none opacity-80 hover:opacity-100">
            ×
          </button>
        )}
      </div>
      {isError && (
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <CopyButton
            text={t.report}
            label="نسخ التفاصيل"
            className="bg-white/20 hover:bg-white/30 rounded-lg px-2.5 py-1 text-xs font-semibold transition"
          />
          {t.detailsText && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="bg-white/20 hover:bg-white/30 rounded-lg px-2.5 py-1 text-xs font-semibold transition"
            >
              {open ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}
            </button>
          )}
        </div>
      )}
      {isError && open && (
        <pre
          dir="ltr"
          className="mt-2 text-[11px] leading-relaxed font-normal whitespace-pre-wrap break-all text-left bg-black/20 rounded-lg p-2 max-h-48 overflow-y-auto select-text"
        >
          {t.detailsText}
        </pre>
      )}
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast لازم يتستخدم جوه ToastProvider');
  return ctx;
}

/* ============ ErrorBoundary: لو صفحة وقعت وهي بترسم، بدل الشاشة البيضا بتظهر الرسالة وتقدر تنسخها ============ */
export class ErrorBoundary extends Component {
  state = { error: null, info: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary:', error, info);
    this.setState({ info });
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    const details = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: info?.componentStack,
    };
    const detailsText = describeDetails(details);
    const report = buildErrorReport('خطأ في عرض الصفحة', details, detailsText);

    return (
      <div className="card p-6 max-w-2xl mx-auto mt-6">
        <p className="font-messiri text-xl font-bold text-coral mb-1">حصلت مشكلة في عرض الصفحة</p>
        <p className="text-sm text-muted mb-4">باقي اللوحة شغّالة. انسخ التفاصيل وابعتها لو المشكلة اتكررت.</p>
        <p className="font-semibold text-sm mb-3 break-words select-text" dir="auto">{error.message}</p>
        <div className="flex gap-2 flex-wrap mb-3">
          <CopyButton text={report} label="نسخ تفاصيل الخطأ" className="btn-primary !px-3 !py-1.5 text-sm" />
          <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" onClick={this.reset}>إعادة المحاولة</button>
          <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" onClick={() => window.location.reload()}>تحميل الصفحة تاني</button>
        </div>
        <pre dir="ltr" className="text-[11px] whitespace-pre-wrap break-all text-left bg-parchment/60 rounded-lg p-3 max-h-72 overflow-y-auto select-text">
          {detailsText}
        </pre>
      </div>
    );
  }
}

/* ============ Confirm Dialog (بديل عصري لـ window.confirm) ============ */
const ConfirmCtx = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null); // { message, resolve, danger }

  const confirm = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      setState({ message, resolve, danger: opts.danger, confirmLabel: opts.confirmLabel || 'تأكيد' });
    });
  }, []);

  const close = (result) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/40 backdrop-blur-[2px] px-4">
          <div className="card p-6 w-full max-w-sm animate-riseIn">
            <p className="font-semibold text-inktext mb-5 leading-relaxed">{state.message}</p>
            <div className="flex gap-2 justify-end">
              <button className="btn-ghost" onClick={() => close(false)}>إلغاء</button>
              <button
                className={state.danger ? 'btn-danger' : 'btn-primary'}
                onClick={() => close(true)}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirm لازم يتستخدم جوه ConfirmProvider');
  return ctx;
}

/* ============ عناصر مشتركة ============ */

export function Stamp({ children, tone = 'ink' }) {
  const toneClass = {
    ink: 'text-ink',
    coral: 'text-coral',
    forest: 'text-forest',
    gold: 'text-gold-dark',
  }[tone];
  return <span className={`stamp ${toneClass}`}>{children}</span>;
}

export function PageHeader({ eyebrow, title, action }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-7 flex-wrap">
      <div>
        {eyebrow && (
          <p className="font-messiri text-gold-dark text-sm font-semibold tracking-wide mb-1">{eyebrow}</p>
        )}
        <h2 className="font-messiri text-2xl md:text-3xl font-bold text-inktext">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon = '◇', title, hint }) {
  return (
    <div className="card p-10 text-center">
      <div className="w-12 h-12 mx-auto rounded-full bg-parchment flex items-center justify-center text-xl mb-3">{icon}</div>
      <p className="font-semibold text-inktext">{title}</p>
      {hint && <p className="text-sm text-muted mt-1">{hint}</p>}
    </div>
  );
}

export function Spinner({ label = 'جارِ التحميل...' }) {
  return (
    <div className="flex items-center gap-3 text-muted py-10 justify-center">
      <span className="w-4 h-4 rounded-full border-2 border-ink/20 border-t-ink animate-spin" />
      {label}
    </div>
  );
}
