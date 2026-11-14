// منطق صفحة أعطال التطبيق (نقي، من غير React ولا Supabase) عشان يتختبر لوحده.
// البيانات جاية من views على السيرفر (sql/supabase_client_errors_v2.sql):
//   client_error_groups: صف لكل عطل (signature = بصمة العطل)
//   client_error_daily:  لكل يوم (بتوقيت القاهرة) + kind + app_version
//   client_error_status: حالة العطل (الأدمن بس بيكتب فيها)

export const DAY_MS = 24 * 60 * 60 * 1000;

// نفس صيغة app_version في التطبيق: x.y.z+n
export const VERSION_RE = /^\d+\.\d+\.\d+\+\d+$/;

export const STATUS_LABEL = { open: 'مفتوح', fixed: 'اتصلح', ignored: 'متجاهَل' };

// الـ view مش موجودة لسه (الملف ماتشغّلش)؟
export function isMissingRelation(error) {
  if (!error) return false;
  const text = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    text.includes('does not exist') ||
    text.includes('could not find the table') ||
    text.includes('schema cache')
  );
}

export function validateStatusForm({ status, fixedIn }) {
  if (!['open', 'fixed', 'ignored'].includes(status)) return 'الحالة مش صحيحة';
  if (status === 'fixed') {
    const v = (fixedIn || '').trim();
    if (!v) return 'اكتب الإصدار اللي اتصلح فيه';
    if (!VERSION_RE.test(v)) return 'صيغة الإصدار لازم تبقى x.y.z+n (مثال: 3.0.1+4)';
  }
  return null;
}

export function statusPayload({ signature, status, fixedIn, note }, now = new Date()) {
  return {
    signature,
    status,
    fixed_in_version: status === 'fixed' ? fixedIn.trim() : null,
    note: (note || '').trim() || null,
    updated_at: now.toISOString(),
  };
}

export function allVersions(groups) {
  const set = new Set();
  for (const g of groups) for (const v of g.versions || []) if (v) set.add(v);
  return [...set].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
}

// الفلاتر: التبويب (bug/network)، الحالة، الإصدار، المدى الزمني على last_seen، و"رجع تاني"
export function filterGroups(groups, { tab = 'bug', statusFilter = 'active', version = 'الكل', rangeDays = null, regressedOnly = false, now = Date.now() } = {}) {
  return groups.filter((g) => {
    if (regressedOnly) return !!g.regressed;
    if (g.kind !== tab) return false;
    if (statusFilter === 'active' && g.status === 'ignored') return false;
    if (['open', 'fixed', 'ignored'].includes(statusFilter) && g.status !== statusFilter) return false;
    if (version !== 'الكل' && !(g.versions || []).includes(version)) return false;
    if (rangeDays && now - new Date(g.last_seen).getTime() > rangeDays * DAY_MS) return false;
    return true;
  });
}

// الأولوية: "رجع تاني" فوق، وبعدين عدد الأجهزة المختلفة (مش عدد المرات)، وبعدين آخر ظهور
export function sortGroups(groups, sortBy = 'devices') {
  const copy = [...groups];
  copy.sort((a, b) => {
    if (!!a.regressed !== !!b.regressed) return a.regressed ? -1 : 1;
    if (sortBy === 'last_seen') return new Date(b.last_seen) - new Date(a.last_seen);
    if (sortBy === 'reports') return b.reports - a.reports || b.devices - a.devices;
    return b.devices - a.devices || new Date(b.last_seen) - new Date(a.last_seen);
  });
  return copy;
}

// وصف مقروء لـ extra (ممكن يبقى null في التقارير القديمة)
export function describeExtra(extra) {
  if (!extra || typeof extra !== 'object') return [];
  const out = [];
  const conn = { wifi: 'واي فاي', mobile: 'بيانات موبايل', none: 'بدون نت' };
  if (extra.conn !== undefined && extra.conn !== null) out.push(conn[extra.conn] || `اتصال: ${extra.conn}`);
  if (extra.logged_in === true) out.push('مسجّل دخول');
  if (extra.logged_in === false) out.push('ضيف');
  if (extra.foreground === true) out.push('التطبيق مفتوح');
  if (extra.foreground === false) out.push('التطبيق في الخلفية');
  if (typeof extra.uptime_s === 'number' && extra.uptime_s >= 0) out.push(`بعد ${formatUptime(extra.uptime_s)} من فتح التطبيق`);
  return out;
}

export function formatUptime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)} ث`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} د`;
  return `${(seconds / 3600).toFixed(1).replace(/\.0$/, '')} س`;
}

// كام جهاز من التقارير كان من غير نت. لو الأغلبية كده، العطل غالبًا نت حتى لو مش مصنّف network
export function connNoneStats(reports) {
  const all = new Set();
  const none = new Set();
  for (const r of reports) {
    if (!r.device_id) continue;
    all.add(r.device_id);
    if (r.extra && r.extra.conn === 'none') none.add(r.device_id);
  }
  return { none: none.size, total: all.size, mostlyNone: all.size > 0 && none.size / all.size > 0.5 };
}

// تاريخ اليوم بتوقيت القاهرة بصيغة yyyy-MM-dd (client_error_daily بتحسب اليوم بتوقيت القاهرة)
export function cairoDate(now = Date.now()) {
  return new Date(now).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

// مجموع الأجهزة لعطل من نوع معيّن في يوم. ملحوظة: الـ view مقسّمة بالإصدار، فجهاز غيّر إصداره
// في نفس اليوم ممكن يتعدّ مرتين، فالرقم تقريبي (غالبًا مفيش فرق يُذكر).
export function sumDaily(rows, { day, kind, metric = 'devices' }) {
  return rows.filter((r) => r.day === day && r.kind === kind).reduce((s, r) => s + (Number(r[metric]) || 0), 0);
}

// سلسلة آخر N يوم للرسم البياني (الأيام الفاضية = 0)
export function buildDailySeries(rows, { days = 30, metric = 'devices', now = Date.now() } = {}) {
  const labels = [];
  for (let i = days - 1; i >= 0; i--) labels.push(cairoDate(now - i * DAY_MS));
  const sum = (kind) => labels.map((day) => sumDaily(rows, { day, kind, metric }));
  return { labels, bug: sum('bug'), network: sum('network') };
}

// نص تقرير العطل كامل جاهز للنسخ (لكلود التطبيق مثلًا)
export function groupReportText(g, reports = []) {
  const lines = [
    `العطل: ${g.sample_message || '(بدون رسالة)'}`,
    `البصمة: ${g.signature}`,
    `النوع: ${g.kind === 'bug' ? 'باج' : 'شبكة'}`,
    `الموقع في الكود: ${g.top_frame || '—'}`,
    `عدد الأجهزة: ${g.devices} · عدد التقارير: ${g.reports}`,
    `أول ظهور: ${g.first_seen ? new Date(g.first_seen).toISOString() : '—'}`,
    `آخر ظهور: ${g.last_seen ? new Date(g.last_seen).toISOString() : '—'}`,
    `الإصدارات: ${(g.versions || []).join('، ') || '—'}`,
    `الحالة: ${STATUS_LABEL[g.status] || g.status}${g.status === 'fixed' && g.fixed_in_version ? ` في ${g.fixed_in_version}` : ''}${g.regressed ? ' — رجع تاني بعد الإصلاح' : ''}`,
  ];
  if (g.note) lines.push(`ملاحظة: ${g.note}`);
  if (reports.length > 0) {
    const stats = connNoneStats(reports);
    if (stats.total > 0) lines.push(`بدون نت: ${stats.none} من ${stats.total} جهاز (آخر ${reports.length} تقرير)`);
  }
  lines.push('', 'Stack:', g.sample_stack || 'مفيش stack مسجّل');
  return lines.join('\n');
}

export function summaryText(groups, { filters = '', total = groups.length, now = new Date() } = {}) {
  const head = [`أعطال التطبيق — ${total} عطل`, filters || null, `تاريخ التقرير: ${now.toISOString()}`].filter(Boolean).join('\n');
  const body = groups
    .slice(0, 15)
    .map((g, i) => `#${i + 1}\n${groupReportText(g)}`)
    .join('\n\n----------------------------------------\n\n');
  return `${head}\n\n${body}`;
}
