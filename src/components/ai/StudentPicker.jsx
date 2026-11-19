import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useToast } from '../UI';

// حروف بتبوّظ فلتر PostgREST (or=...) أو بتشتغل كـ wildcard، فبنشيلها من نص البحث
const cleanQuery = (text) => text.replace(/[,()%*\\_"']/g, ' ').replace(/\s+/g, ' ').trim();

// اختيار طالب بالبحث بالاسم أو الإيميل (من profiles). value = { id, name, email } أو null.
export default function StudentPicker({ value, onChange, disabled = false }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    const q = cleanQuery(query);
    if (q.length < 2) { setResults([]); return undefined; }
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email')
        .or(`name.ilike.%${q}%,email.ilike.%${q}%`)
        .order('name')
        .limit(8);
      if (ticket !== latest.current) return; // بحث أحدث اتبعت بعده
      setSearching(false);
      if (error) { toast('تعذّر البحث عن الطلاب', 'error', error); return; }
      setResults(data || []);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, toast]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 bg-surface rounded-xl px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{value.name || 'من غير اسم'}</p>
          {value.email && <p className="text-xs text-muted truncate" dir="ltr">{value.email}</p>}
        </div>
        {!disabled && (
          <button type="button" onClick={() => { onChange(null); setQuery(''); }} className="btn-ghost !px-3 !py-1 text-xs shrink-0">
            غيّر
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ابحث بالاسم أو الإيميل (حرفين على الأقل)"
        className="input-field"
        aria-label="بحث عن طالب"
      />
      {searching && <p className="text-xs text-muted mt-1.5">جارِ البحث...</p>}
      {!searching && cleanQuery(query).length >= 2 && results.length === 0 && (
        <p className="text-xs text-muted mt-1.5">مفيش حد بالاسم ده</p>
      )}
      {results.length > 0 && (
        <ul className="mt-1.5 border border-surface-line rounded-xl overflow-hidden divide-y divide-surface-line bg-white">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => onChange(p)} className="w-full text-right px-3 py-2 hover:bg-surface transition">
                <span className="block text-sm font-semibold truncate">{p.name || 'من غير اسم'}</span>
                {p.email && <span className="block text-xs text-muted truncate" dir="ltr">{p.email}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
