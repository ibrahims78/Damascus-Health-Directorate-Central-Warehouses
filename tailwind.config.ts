import type { Config } from 'tailwindcss';

/**
 * رموز التصميم المركزية (Design Tokens).
 * لا تُكتب الألوان أو المقاييس مباشرة داخل المكوّنات.
 */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6fb',
          100: '#d7e9f5',
          300: '#8fc0dd',
          500: '#1a5276',
          600: '#154360',
          700: '#10344a',
        },
        surface: '#ffffff',
        canvas: '#f4f7fa',
        line: '#dbe4ec',
        ink: '#0f172a',
        muted: '#5b6b82',
        danger: { 50: '#fef2f2', 500: '#dc2626', 700: '#991b1b' },
        success: { 50: '#ecfdf5', 500: '#059669', 700: '#065f46' },
        warn: { 50: '#fffbeb', 500: '#d97706', 700: '#92400e' },
      },
      fontFamily: {
        sans: ['Segoe UI', 'Tahoma', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl: '0.9rem', '2xl': '1.15rem' },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,.06), 0 8px 24px -12px rgba(15,23,42,.18)',
      },
      spacing: { 18: '4.5rem' },
    },
  },
  plugins: [],
} satisfies Config;
