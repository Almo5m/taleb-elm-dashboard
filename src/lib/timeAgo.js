// وقت نسبي بالعامية المصرية: "من ساعتين"، "من 3 أيام". بعد 30 يوم بيرجع التاريخ.
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function unit(n, one, two, few, many) {
  if (n === 1) return `من ${one}`;
  if (n === 2) return `من ${two}`;
  if (n <= 10) return `من ${n} ${few}`;
  return `من ${n} ${many}`;
}

export function timeAgo(value, now = Date.now()) {
  if (!value) return '—';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Math.max(0, now - t);
  if (diff < MIN) return 'دلوقتي';
  if (diff < HOUR) return unit(Math.floor(diff / MIN), 'دقيقة', 'دقيقتين', 'دقايق', 'دقيقة');
  if (diff < DAY) return unit(Math.floor(diff / HOUR), 'ساعة', 'ساعتين', 'ساعات', 'ساعة');
  if (diff <= 30 * DAY) return unit(Math.floor(diff / DAY), 'يوم', 'يومين', 'أيام', 'يوم');
  return new Date(t).toLocaleDateString('ar-EG');
}
