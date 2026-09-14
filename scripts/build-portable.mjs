import { cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * بناء نسخة محمولة (Portable) جاهزة للتشغيل دون تثبيت ودون إنترنت:
 * وقت تشغيل Electron المحلي + ملفات التطبيق المبنية داخل resources/app.
 * لا يستخدم electron-builder لتفادي أي تنزيل من الشبكة.
 *
 * الاستخدام:
 *   npm run build:portable
 * متغيرات اختيارية:
 *   ELECTRON_DIST  مسار مجلد وقت تشغيل Electron (افتراضيًا من node_modules)
 *   PORTABLE_OUT   مجلد الإخراج (افتراضيًا release/portable)
 */

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '..');

const pkg = JSON.parse(
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (await import('node:fs')).readFileSync(join(project, 'package.json'), 'utf8'),
);

const dist = process.env['ELECTRON_DIST'] ?? join(project, 'node_modules/electron/dist');
const built = join(project, 'out');
const target = process.env['PORTABLE_OUT'] ?? join(project, 'release/portable');
const appDir = join(target, 'resources/app');
const exeName = 'WHSHAM-Central-Warehouses.exe';

for (const required of [dist, built]) {
  if (!existsSync(required)) {
    console.error('مفقود: ' + required);
    console.error('شغّل أولًا: npm run setup:electron && npm run build');
    process.exit(1);
  }
}

mkdirSync(appDir, { recursive: true });

// 1) وقت التشغيل المحلي
cpSync(dist, target, { recursive: true });

// 2) ملفات التطبيق المبنية
cpSync(built, join(appDir, 'out'), { recursive: true });

// 3) بيانات التطبيق (بدون productName ليبقى مجلد البيانات نفسه بعد التحديثات)
writeFileSync(
  join(appDir, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      main: 'out/main/index.js',
      description: pkg.description,
    },
    null,
    2,
  ),
  'utf8',
);

// 4) اسم واضح للملف التنفيذي
const defaultExe = join(target, 'electron.exe');
if (existsSync(defaultExe)) renameSync(defaultExe, join(target, exeName));

console.log('PORTABLE_DIR=' + target);
console.log('EXE=' + join(target, exeName));
console.log('VERSION=' + pkg.version);
