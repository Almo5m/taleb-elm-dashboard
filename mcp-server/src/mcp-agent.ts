import { McpAgent } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ALLOWED_TABLES, countTable, isAllowedTable, queryTable } from './supabase';

interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_JWT_SECRET: string;
}

type Props = {
  adminEmail: string;
  adminId: string;
};

export class TalebElmMcp extends McpAgent<Env, unknown, Props> {
  server = new McpServer({ name: 'taleb-elm-admin', version: '1.0.0' });

  async init() {
    this.server.tool(
      'list_tables',
      'يرجع أسماء كل الجداول المسموح قراءتها من لوحة تحكم طالب علم',
      {},
      async () => ({
        content: [{ type: 'text', text: JSON.stringify(ALLOWED_TABLES, null, 2) }],
      })
    );

    this.server.tool(
      'query_table',
      'يقرأ صفوف من جدول معيّن في لوحة تحكم طالب علم (قراءة فقط). استخدمه للاطلاع على تفاصيل محددة زي بيانات طالب، بلاغات، أو سجل نشاط.',
      {
        table: z.enum(ALLOWED_TABLES),
        columns: z.string().optional().describe('أسماء الأعمدة المطلوبة مفصولة بفاصلة، افتراضيًا كل الأعمدة'),
        filters: z
          .array(
            z.object({
              column: z.string(),
              operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in']),
              value: z.string(),
            })
          )
          .optional(),
        order_by: z.string().optional(),
        order_desc: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      async ({ table, columns, filters, order_by, order_desc, limit }) => {
        if (!isAllowedTable(table)) {
          return { content: [{ type: 'text', text: 'جدول غير مسموح' }], isError: true };
        }
        try {
          const rows = await queryTable(this.env, {
            table,
            columns,
            filters,
            orderBy: order_by,
            orderDesc: order_desc,
            limit,
          });
          return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: String(err) }], isError: true };
        }
      }
    );

    this.server.tool(
      'get_dashboard_stats',
      'يرجع إحصائيات سريعة عن حالة التطبيق: عدد الطلاب، البلاغات المعلقة، استخدام الذكاء الاصطناعي هذا الشهر، وعدد المواضيع والردود في المنتدى',
      {},
      async () => {
        const [
          totalStudents,
          totalModerators,
          pendingReports,
          totalThreads,
          totalReplies,
          bannedWordsCount,
        ] = await Promise.all([
          countTable(this.env, 'profiles', [{ column: 'role', operator: 'eq', value: 'student' }]),
          countTable(this.env, 'profiles', [{ column: 'role', operator: 'in', value: '(admin,moderator)' }]),
          countTable(this.env, 'forum_reports', [{ column: 'status', operator: 'eq', value: 'pending' }]),
          countTable(this.env, 'forum_threads'),
          countTable(this.env, 'forum_replies'),
          countTable(this.env, 'banned_words'),
        ]);

        const now = new Date();
        const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        const monthlyUsage = await queryTable(this.env, {
          table: 'ai_usage_monthly',
          filters: [{ column: 'month', operator: 'eq', value: month }],
          limit: 1,
        });

        const stats = {
          total_students: totalStudents,
          total_staff: totalModerators,
          pending_reports: pendingReports,
          total_forum_threads: totalThreads,
          total_forum_replies: totalReplies,
          banned_words_count: bannedWordsCount,
          ai_messages_this_month: (monthlyUsage as any[])?.[0]?.message_count ?? 0,
        };

        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      }
    );
  }
}
