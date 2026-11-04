// feature_id لازم تتطابق حرفيًا مع التطبيق. القايمة دي هتكبر لما نضيف خلفيات بالصور.
export const UNLOCKABLE_KINDS = {
  canvas_pen: 'أقلام الكانفا',
  timer_background: 'خلفيات المؤقت',
};

export const UNLOCKABLE_FEATURES = [
  // أقلام الكانفا (القلم العادي "pen" دايمًا مفتوح ومش بيتقفل)
  { feature_id: 'pen_fountain',    kind: 'canvas_pen', label: 'قلم الحبر' },
  { feature_id: 'pen_pencil',      kind: 'canvas_pen', label: 'قلم الرصاص' },
  { feature_id: 'pen_marker',      kind: 'canvas_pen', label: 'الماركر' },
  { feature_id: 'pen_highlighter', kind: 'canvas_pen', label: 'الهايلايتر' },

  // خلفيات المؤقت (الأولى "هادي" هي الافتراضية، وممكن تتقفل برضو)
  { feature_id: 'bg_calm',   kind: 'timer_background', label: 'خلفية: هادي' },
  { feature_id: 'bg_forest', kind: 'timer_background', label: 'خلفية: الغابة والشلال' },
  { feature_id: 'bg_lake',   kind: 'timer_background', label: 'خلفية: البحيرة الجبلية' },
  { feature_id: 'bg_sunset', kind: 'timer_background', label: 'خلفية: غروب البحر' },
  { feature_id: 'bg_night',  kind: 'timer_background', label: 'خلفية: سماء الليل' },
  { feature_id: 'bg_rain',   kind: 'timer_background', label: 'خلفية: أجواء المطر' },
];
