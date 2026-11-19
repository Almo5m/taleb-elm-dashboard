import test from 'node:test';
import assert from 'node:assert/strict';
import { contactWarnings } from '../../src/lib/contactLinks.js';

test('روابط التواصل: تحذيرات', () => {
  assert.equal(contactWarnings({ whatsapp: 'https://wa.me/201000000000' }).length, 0);
  assert.equal(contactWarnings({ email: 'mailto:a@b.com' }).length, 0);
  assert.match(contactWarnings({})[0], /مفيش/);
  assert.match(contactWarnings(null)[0], /مفيش/);
  assert.match(contactWarnings({ telegram_group: 'https://t.me/x' })[0], /مفيش/); // الجروب مش وسيلة مباشرة
  assert.ok(contactWarnings({ whatsapp: 'wa.me/2010' }).some((w) => /واتساب/.test(w)));
  assert.ok(contactWarnings({ email: 'a@b.com' }).some((w) => /الإيميل/.test(w)));
  assert.ok(contactWarnings({ email: 'mailto:bad', whatsapp: 'https://wa.me/1' }).some((w) => /الإيميل/.test(w)));
  assert.equal(contactWarnings({ whatsapp: '  https://wa.me/1  ' }).length, 0);
});
