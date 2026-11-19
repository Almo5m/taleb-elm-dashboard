// مساعدات assert صغيرة (من غير مكتبات خارجية عشان الاختبارات تشتغل من غير شبكة)
export function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(`فشل: ${msg}`);
}
export function eq<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`فشل: ${msg}\n  المتوقع: ${e}\n  الفعلي:  ${a}`);
}
