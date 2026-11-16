/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        cairo: ['Cairo', 'sans-serif'],
        messiri: ['"El Messiri"', 'serif'],
      },
      // ألوان الهوية مأخوذة من أيقونة التطبيق (نيلي + تركواز)، بدرجات هادية للعين:
      //   ink     النيلي الأساسي (القايمة الجانبية، الأزرار، العناوين)
      //   surface خلفيات الصفحة والكروت (أزرق رمادي فاتح جدًا بدل الأبيض الصريح)
      //   accent  التركواز بتاع الهوية. DEFAULT للخلفيات والعناصر على النيلي، و dark للنصوص على الفاتح
      //   coral / forest / amber  ألوان الحالات: خطر / نجاح / تنبيه
      colors: {
        ink: {
          DEFAULT: '#0A2A5E',
          light: '#12376F',
          soft: '#1D4580',
        },
        surface: {
          DEFAULT: '#F3F6FB',
          card: '#FFFFFF',
          line: '#DCE4F0',
        },
        accent: {
          DEFAULT: '#20E1B2',
          dark: '#0A7F66',
          soft: '#E3FAF3',
        },
        coral: {
          DEFAULT: '#D0402F',
          dark: '#B3352A',
        },
        forest: {
          DEFAULT: '#17724A',
          dark: '#115A3A',
        },
        amber: {
          DEFAULT: '#E0A52B',
          dark: '#8F6205',
        },
        inktext: '#14213D',
        muted: '#5B6D8C',
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(10,42,94,0.05), 0 8px 24px -14px rgba(10,42,94,0.22)',
        stamp: '0 0 0 2px rgba(0,0,0,0.02)',
      },
      borderRadius: {
        card: '18px',
      },
      keyframes: {
        stampIn: {
          '0%': { opacity: '0', transform: 'scale(1.6) rotate(-8deg)' },
          '60%': { opacity: '1', transform: 'scale(0.95) rotate(-6deg)' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(-6deg)' },
        },
        riseIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        stampIn: 'stampIn 0.35s cubic-bezier(.2,.8,.25,1)',
        riseIn: 'riseIn 0.25s ease-out',
      },
    },
  },
  plugins: [],
};
