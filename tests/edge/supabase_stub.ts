// بديل بسيط لـ supabase-js للاختبارات: جداول في الذاكرة + نفس طريقة الاستدعاء اللي الدالة بتستخدمها.
// مش بيحاول يغطي supabase-js كله، بس الأنماط المستخدمة في ai-assistant.
// deno-lint-ignore-file no-explicit-any

type Row = Record<string, any>;

export const db: Record<string, Row[]> = {};
export const failTables = new Set<string>(); // جداول بتفشل (مثلًا جدول لسه ماتعملش)
export const users = new Map<string, string>(); // token → user id

const PK: Record<string, string[]> = {
  ai_rate_limit: ['user_id'],
  ai_model_state: ['model'],
  ai_usage_alerts: ['month', 'threshold', 'cap'],
  ai_usage_daily: ['user_id', 'usage_date'],
  ai_usage_monthly: ['month'],
};

export function resetDb() {
  for (const k of Object.keys(db)) delete db[k];
  failTables.clear();
  users.clear();
}

export const table = (name: string) => (db[name] ??= []);

class Query {
  private filters: ((r: Row) => boolean)[] = [];
  private action: 'select' | 'upsert' | 'update' | 'insert' = 'select';
  private payload: Row | null = null;
  private opts: Row = {};
  private returnRows = false;

  constructor(private name: string) {}

  select(_cols?: string) {
    if (this.action !== 'select') this.returnRows = true;
    return this;
  }
  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  in(col: string, vals: unknown[]) { this.filters.push((r) => vals.includes(r[col])); return this; }
  gt(col: string, val: string) { this.filters.push((r) => r[col] != null && String(r[col]) > val); return this; }
  upsert(row: Row, opts: Row = {}) { this.action = 'upsert'; this.payload = row; this.opts = opts; return this; }
  update(patch: Row) { this.action = 'update'; this.payload = patch; return this; }
  insert(row: Row) { this.action = 'insert'; this.payload = row; return this; }

  private run(): { data: any; error: { message: string } | null } {
    if (failTables.has(this.name)) return { data: null, error: { message: `relation "${this.name}" does not exist` } };
    const rows = table(this.name);
    if (this.action === 'select') return { data: rows.filter((r) => this.filters.every((f) => f(r))).map((r) => ({ ...r })), error: null };
    if (this.action === 'insert') { rows.push({ ...this.payload! }); return { data: null, error: null }; }
    if (this.action === 'update') {
      for (const r of rows.filter((r) => this.filters.every((f) => f(r)))) Object.assign(r, this.payload);
      return { data: null, error: null };
    }
    const keys = (this.opts.onConflict ? String(this.opts.onConflict).split(',').map((s) => s.trim()) : PK[this.name]) ?? [];
    const existing = keys.length ? rows.find((r) => keys.every((k) => r[k] === this.payload![k])) : undefined;
    if (existing) {
      if (this.opts.ignoreDuplicates) return { data: [], error: null };
      Object.assign(existing, this.payload);
      return { data: [{ ...existing }], error: null };
    }
    rows.push({ ...this.payload! });
    return { data: [{ ...this.payload! }], error: null };
  }

  maybeSingle() {
    const res = this.run();
    return Promise.resolve({ data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data, error: res.error });
  }

  // makes `await query` and `.then(cb)` work
  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

export function createClient(_url: string, _key: string) {
  return {
    auth: {
      getUser(jwt: string) {
        const id = users.get(jwt);
        return Promise.resolve(id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: 'invalid' } });
      },
    },
    from: (name: string) => new Query(name),
    rpc(fn: string, params: Row) {
      if (fn !== 'ai_record_usage') return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
      const daily = table('ai_usage_daily');
      let d = daily.find((r) => r.user_id === params.p_user_id && r.usage_date === params.p_usage_date);
      if (!d) { d = { user_id: params.p_user_id, usage_date: params.p_usage_date, message_count: 0 }; daily.push(d); }
      d.message_count++;
      const monthly = table('ai_usage_monthly');
      let m = monthly.find((r) => r.month === params.p_month);
      if (!m) { m = { month: params.p_month, message_count: 0 }; monthly.push(m); }
      m.message_count++;
      return Promise.resolve({ data: [{ daily_count: d.message_count, monthly_count: m.message_count }], error: null });
    },
  };
}
