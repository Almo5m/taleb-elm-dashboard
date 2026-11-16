// شعار طالب علم (نفس أيقونة التطبيق). حجم واحد بيتحدد بالـ prop عشان أي مكان يستخدمه من غير ما يكرر الأبعاد.
// الصورة: public/logo.png (192×192)، وبتتعرض أصغر على الشاشات العادية وبحدة كاملة على الشاشات عالية الدقة.
const SIZES = {
  sm: 'w-8 h-8 rounded-lg',
  md: 'w-11 h-11 rounded-xl',
  lg: 'w-16 h-16 rounded-2xl',
};

export default function BrandLogo({ size = 'md', className = '' }) {
  return (
    <img
      src="/logo.png"
      alt="طالب علم"
      width="192"
      height="192"
      className={`${SIZES[size] || SIZES.md} shrink-0 shadow-sm ${className}`}
    />
  );
}
