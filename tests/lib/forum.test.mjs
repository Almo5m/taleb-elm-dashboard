import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarColumnOf, buildReplyFeed, formatCairoDateTime, uniqueValues } from '../../src/lib/forum.js';

test('عمود صورة الكاتب: بيتكشف من الصف نفسه', () => {
  assert.equal(avatarColumnOf({ id: 1, author_id: 'u', author_name: 'x', author_avatar_url: 'https://a/b.png' }), 'author_avatar_url');
  assert.equal(avatarColumnOf({ id: 1, avatar_url: 'x', author_photo: 'y' }), 'author_photo'); // الأولوية لـ author
  assert.equal(avatarColumnOf({ id: 1, avatar_url: 'x' }), 'avatar_url');
  assert.equal(avatarColumnOf({ id: 1, body: 'نص' }), null);
  assert.equal(avatarColumnOf(null), null);
  assert.equal(avatarColumnOf('x'), null);
});

test('القيم الفريدة', () => {
  assert.deepEqual(uniqueValues([{ a: 1 }, { a: 1 }, { a: null }, { a: 2 }, {}], 'a'), [1, 2]);
  assert.deepEqual(uniqueValues(null, 'a'), []);
});

test('فيد الردود: بيربط الرد بالسؤال وصاحبه ودور المُجيب', () => {
  const feed = buildReplyFeed(
    [{ id: 'r1', thread_id: 't1', author_id: 'a1', author_name: 'معاذ', body: 'تمام', created_at: '2026-11-19T10:00:00Z' },
     { id: 'r2', thread_id: 'gone', author_id: null, author_name: null, body: null, created_at: null }],
    [{ id: 't1', title: 'سؤال', author_name: 'أحمد', author_id: 's1' }],
    { a1: 'admin' },
  );
  assert.deepEqual(feed[0], { id: 'r1', threadId: 't1', threadTitle: 'سؤال', askerName: 'أحمد', askerId: 's1', authorId: 'a1', authorName: 'معاذ', role: 'admin', body: 'تمام', createdAt: '2026-11-19T10:00:00Z' });
  assert.equal(feed[1].threadTitle, null); // السؤال اتمسح
  assert.equal(feed[1].authorName, 'مستخدم');
  assert.equal(feed[1].role, null);
  assert.deepEqual(buildReplyFeed(null, null, null), []);
});

test('وقت القاهرة', () => {
  assert.equal(formatCairoDateTime(null), '—');
  assert.equal(formatCairoDateTime('x'), '—');
  assert.match(formatCairoDateTime('2026-11-19T13:18:04Z'), /٣:١٨|3:18/); // ١٥:١٨ بالقاهرة
});
