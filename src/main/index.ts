import { app, BrowserWindow, Menu, session, shell } from 'electron';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initDatabase } from './db/database';
import { registerIpcHandlers } from './ipc/register';

const isDev = !!process.env['ELECTRON_RENDERER_URL'];

/** سجل تشخيصي محلي بسيط — يساعد الدعم الفني دون أي إرسال خارجي. */
function logLine(message: string): void {
  try {
    const file = join(app.getPath('userData'), 'diagnostics.log');
    appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch {
    /* لا يجب أن يفشل التشغيل بسبب السجل */
  }
}

process.on('uncaughtException', (error) => {
  logLine(`uncaughtException: ${error?.stack ?? String(error)}`);
});
process.on('unhandledRejection', (reason) => {
  logLine(`unhandledRejection: ${String(reason)}`);
});

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
  win.webContents.on('did-fail-load', (_event, code, description, url) => {
    logLine(`did-fail-load ${code} ${description} ${url}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    logLine(`render-process-gone ${JSON.stringify(details)}`);
  });

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

function bootstrap(): void {
  Menu.setApplicationMenu(null);

  const userDataDir = app.getPath('userData');
  const backupDir = join(userDataDir, 'backups');
  logLine(`startup: app=${app.getName()} electron=${process.versions['electron']} node=${process.versions.node} userData=${userDataDir}`);

  const { dbPath, initialAdminPassword } = initDatabase(userDataDir);
  logLine(`database ready: ${dbPath}`);

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
    logLine('initial admin password generated');
  }

  applyContentSecurityPolicy();
  registerIpcHandlers({ dbPath, backupDir });
  logLine('ipc handlers registered');

  createWindow();
  logLine('window created');
}

// نسخة واحدة فقط من التطبيق (يمنع تعارض الكتابة على القاعدة).
try {
  if (!app.requestSingleInstanceLock()) {
    logLine('another instance is running — exiting');
    app.quit();
  } else {
    app.on('second-instance', () => {
      const [win] = BrowserWindow.getAllWindows();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });

    void app
      .whenReady()
      .then(() => {
        bootstrap();
      })
      .catch((error) => {
        logLine(`bootstrap failed: ${(error as Error)?.stack ?? String(error)}`);
      });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }
} catch (error) {
  logLine(`fatal at startup: ${(error as Error)?.stack ?? String(error)}`);
}
