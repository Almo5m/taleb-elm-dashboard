import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarUrlProblem } from '../../src/lib/avatar.js';

test('رابط الصورة: https بس وشكل سليم', () => {
  assert.equal(avatarUrlProblem('https://example.com/a.png'), null);
  assert.equal(avatarUrlProblem('  https://example.com/a.png  '), null);
  for (const bad of ['', '   ', null, 'http://example.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAA', 'example.com/a.png', 'https://exa mple.com/a b.png', `https://e.com/${'a'.repeat(1000)}`]) {
    assert.notEqual(avatarUrlProblem(bad), null, String(bad));
  }
});
