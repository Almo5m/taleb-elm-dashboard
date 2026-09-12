// كل استعلام بيعدي من هنا بيتوقّع بيه JWT قصير العمر (60 ثانية) فيه
// "role": "mcp_readonly" — الـ role ده في بوستجرس عنده SELECT بس، مفيش
// INSERT/UPDATE/DELETE خالص، حتى لو الكود هنا فيه غلطة. التحقق الحقيقي
// من صلاحية الكتابة مش هنا، هو في الداتابيز نفسها (supabase_mcp_readonly.sql).

export const ALLOWED_TABLES = [
  'profiles',
  'user_stats',
  'forum_threads',
  'forum_replies',
  'forum_reports',
  'ai_usage_daily',
  'ai_usage_monthly',
  'ai_access',
  'admin_audit_log',
  'banned_words',
  'announcements',
  'app_settings',
  'study_plan_tasks',
  'achievements_catalog',
  'religious_collections',
  'sadaqah',
  'sadaqah_jariyah',
] as const;

export type AllowedTable = (typeof ALLOWED_TABLES)[number];

const ALLOWED_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in'] as const;
export type FilterOperator = (typeof ALLOWED_OPERATORS)[number];

export interface QueryFilter {
  column: string;
  operator: FilterOperator;
  value: string;
}

function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = '';
  for (const byte of bytes) str += String.fromCharCode(byte);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signReadonlyToken(jwtSecret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    role: 'mcp_readonly',
    iss: 'supabase',
    iat: now,
    exp: now + 60,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(jwtSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));

  return `${signingInput}.${base64url(signature)}`;
}

interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_JWT_SECRET: string;
}

async function restHeaders(env: SupabaseEnv): Promise<HeadersInit> {
  const token = await signReadonlyToken(env.SUPABASE_JWT_SECRET);
  return {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
  };
}

export function isAllowedTable(table: string): table is AllowedTable {
  return (ALLOWED_TABLES as readonly string[]).includes(table);
}

export interface QueryTableOptions {
  table: AllowedTable;
  columns?: string;
  filters?: QueryFilter[];
  orderBy?: string;
  orderDesc?: boolean;
  limit?: number;
}

export async function queryTable(env: SupabaseEnv, options: QueryTableOptions) {
  const params = new URLSearchParams();
  params.set('select', options.columns?.trim() || '*');

  for (const filter of options.filters ?? []) {
    if (!ALLOWED_OPERATORS.includes(filter.operator)) {
      throw new Error(`عملية فلترة غير مسموحة: ${filter.operator}`);
    }
    if (!/^[a-z0-9_]+$/i.test(filter.column)) {
      throw new Error(`اسم عمود غير صالح: ${filter.column}`);
    }
    params.append(filter.column, `${filter.operator}.${filter.value}`);
  }

  if (options.orderBy) {
    if (!/^[a-z0-9_]+$/i.test(options.orderBy)) {
      throw new Error(`اسم عمود غير صالح للترتيب: ${options.orderBy}`);
    }
    params.set('order', `${options.orderBy}.${options.orderDesc ? 'desc' : 'asc'}`);
  }

  const safeLimit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  params.set('limit', String(safeLimit));

  const url = `${env.SUPABASE_URL}/rest/v1/${options.table}?${params.toString()}`;
  const response = await fetch(url, { headers: await restHeaders(env) });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`فشل الاستعلام (${response.status}): ${text}`);
  }

  return response.json();
}

export async function countTable(env: SupabaseEnv, table: AllowedTable, filters: QueryFilter[] = []) {
  const params = new URLSearchParams();
  params.set('select', 'id');
  params.set('limit', '1');

  for (const filter of filters) {
    params.append(filter.column, `${filter.operator}.${filter.value}`);
  }

  const url = `${env.SUPABASE_URL}/rest/v1/${table}?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      ...(await restHeaders(env)),
      Prefer: 'count=exact',
    },
  });

  if (!response.ok) return null;

  const contentRange = response.headers.get('content-range');
  if (!contentRange) return null;
  const total = contentRange.split('/')[1];
  return total === '*' ? null : Number(total);
}
