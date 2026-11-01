/** الحقول اللي اتغيّرت بين نسختين: { الحقل: { from, to } } — بيتحط في تفاصيل سجل النشاط */
export function diffFields(before, after) {
  const changes = {};
  for (const key of Object.keys(after)) {
    const from = before?.[key] ?? '';
    if (from !== after[key]) changes[key] = { from, to: after[key] };
  }
  return changes;
}
