import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'logo.png'],
      manifest: {
        name: 'لوحة تحكم طالب علم',
        short_name: 'لوحة تحكم طالب علم',
        description: 'لوحة تحكم إدارة تطبيق طالب علم',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // خلفية شاشة البداية نيلي زي الأيقونة، فالشعار بيظهر من غير حواف
        background_color: '#0A2A5E',
        theme_color: '#0A2A5E',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // بيكاش ملفات الواجهة الثابتة بس (JS/CSS/HTML/الأيقونات) — أي طلب لـ
        // Supabase (api.*.supabase.co) بيفضل يروح الشبكة مباشرة زي ما هو، عشان
        // الأدمن ميشوفش بيانات قديمة (مخزّنة كاش) بالغلط في لوحة إدارية حساسة
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
});
