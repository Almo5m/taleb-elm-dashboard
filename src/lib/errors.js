// أدوات الأخطاء: تحويل أي خطأ لنص كامل قابل للنسخ، ونسخ النص للحافظة.
// بنستخدمها في الإشعارات (Toast) وفي ErrorBoundary وفي صفحة أعطال التطبيق،
// عشان أي رسالة خطأ تتنسخ بكل تفاصيلها وتتبعت لأي حد يساعد في الحل.

// ترتيب الحقول المعروفة (Supabase / Postgres / fetch / Error)
const KNOWN_FIELDS = [
  'name', 'message', 'code', 'status', 'statusText', 'details', 'hint',
  'error', 'error_description', 'msg', 'stack', 'componentStack',
];

function safeStringify(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (key, v) => {
        if (typeof v === 'function') return undefined;
        if (typeof v === 'object' && v !== null) {
          if (typeof Response !== 'undefined' && v instanceof Response) {
            return `[Response ${v.status} ${v.statusText || ''}]`.trim();
          }
          if (seen.has(v)) return '[circular]';
          seen.add(v);
        }
        return v;
      },
      2
    );
  } catch {
    return String(value);
  }
}

// نص التفاصيل الكامل لأي خطأ (Error، كائن خطأ من Supabase، نص، مصفوفة...)
export function describeDetails(details) {
  if (details === null || details === undefined || details === '') return '';
  if (typeof details === 'string') return details;
  if (typeof details === 'number' || typeof details === 'boolean') return String(details);
  if (Array.isArray(details)) {
    return details.map((d) => (typeof d === 'string' ? d : safeStringify(d))).join('\n');
  }
  if (typeof details !== 'object') return String(details);

  const lines = [];
  const used = new Set();
  for (const key of KNOWN_FIELDS) {
    const value = details[key];
    if (value === undefined || value === null || value === '') continue;
    used.add(key);
    lines.push(`${key}: ${typeof value === 'string' ? value : safeStringify(value)}`);
  }
  // أي حقول تانية (مثلًا رد Edge Function)
  const rest = {};
  for (const key of Object.keys(details)) {
    if (!used.has(key)) rest[key] = details[key];
  }
  if (Object.keys(rest).length > 0) lines.push(`data: ${safeStringify(rest)}`);
  return lines.join('\n');
}

// تقرير كامل جاهز للنسخ: الرسالة + الوقت + الصفحة + التفاصيل
export function buildErrorReport(message, details, detailsText = describeDetails(details)) {
  const now = new Date();
  const lines = [
    `الرسالة: ${message}`,
    `الوقت: ${now.toISOString()} (${now.toLocaleString('ar-EG')})`,
    `الصفحة: ${window.location.pathname}${window.location.search}${window.location.hash}`,
  ];
  if (detailsText) {
    lines.push('', 'التفاصيل:', detailsText);
  }
  return lines.join('\n');
}

export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // نكمّل بالطريقة القديمة
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
