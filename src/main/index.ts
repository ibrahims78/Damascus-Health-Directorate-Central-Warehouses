import { app, BrowserWindow, Menu, session, shell } from 'electron';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initDatabase } from './db/database';
import { registerIpcHandlers } from './ipc/register';

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

/** إعدادات أمنية صلبة: لا يصل محتوى الويب إلى Node ولا إلى نظام الملفات. */
function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f7fa',
    title: 'مستودعات مديرية صحة دمشق المركزية',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // منع فتح نوافذ جديدة أو التنقّل خارج التطبيق.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = process.env['ELECTRON_RENDERER_URL'];
    if (!allowed || !url.startsWith(allowed)) event.preventDefault();
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

function applyContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDev
            ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http://localhost:* ws://localhost:*"
            : "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        ],
      },
    });
  });
}

// نسخة واحدة فقط من التطبيق تعمل في الوقت نفسه (يمنع تعارض الكتابة على القاعدة).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null);

    const userDataDir = app.getPath('userData');
    const backupDir = join(userDataDir, 'backups');
    const { dbPath, initialAdminPassword } = initDatabase(userDataDir);

    if (initialAdminPassword) {
      const file = join(userDataDir, 'first-run-admin-password.txt');
      if (!existsSync(file)) {
        writeFileSync(
          file,
          [
            'كلمة مرور المدير الأولية — يجب تغييرها عند أول تسجيل دخول ثم حذف هذا الملف:',
            initialAdminPassword,
            '',
          ].join('\n'),
          { encoding: 'utf8', mode: 0o600 },
        );
      }
      console.log(`[whsham] initial admin password written to ${file}`);
    }

    console.log(`[whsham] database: ${dbPath}`);

    applyContentSecurityPolicy();
    registerIpcHandlers({ dbPath, backupDir });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
