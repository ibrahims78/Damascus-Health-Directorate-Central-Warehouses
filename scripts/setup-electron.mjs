import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * تركيب وقت تشغيل Electron من ملف محلي (بدون إنترنت).
 * الافتراضي: حزمة الأدوات المحلية، ويمكن تجاوزها بتمرير ELECTRON_ZIP.
 */

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const electronDir = join(projectRoot, 'node_modules', 'electron');
const distDir = join(electronDir, 'dist');

const zipPath =
  process.env['ELECTRON_ZIP'] ??
  'D:\\autoclaw projects\\offline-build-tools\\electron-runtime\\electron-v44.3.0-win32-x64.zip';

if (existsSync(join(distDir, 'electron.exe'))) {
  console.log('[setup:electron] وقت التشغيل موجود مسبقًا — لا حاجة لإعادة الاستخراج.');
  process.exit(0);
}

if (!existsSync(zipPath)) {
  console.error(
    [
      '[setup:electron] لم يُعثر على حزمة Electron المحلية:',
      `  ${zipPath}`,
      'مرّر المسار عبر ELECTRON_ZIP، أو شغّل npm install مع اتصال بالإنترنت.',
    ].join('\n'),
  );
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });
console.log(`[setup:electron] استخراج ${zipPath} ...`);
execFileSync(
  'powershell',
  ['-NoProfile', '-Command', `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${distDir}" -Force`],
  { stdio: 'inherit' },
);

writeFileSync(join(electronDir, 'path.txt'), 'electron.exe', 'utf8');
console.log(`[setup:electron] تم — ${join(distDir, 'electron.exe')}`);
