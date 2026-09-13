import { useState } from 'react';
import type { SessionUser } from '../global';

export default function LoginScreen({
  onSignedIn,
}: {
  onSignedIn: (user: SessionUser) => void;
}): React.ReactElement {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await window.whsham.auth.login(form.username, form.password);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setForm({ username: '', password: '' });
    onSignedIn(res.data);
  };

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-brand-500 p-10 text-white lg:flex">
        <div>
          <div className="text-2xl font-bold">WHSHAM</div>
          <div className="mt-1 text-sm text-white/80">نظام إدارة المستودعات المركزي</div>
        </div>
        <ul className="space-y-3 text-sm text-white/85">
          <li>‏• قاعدة بيانات محلية مشفّرة — يعمل دون اتصال بالإنترنت.</li>
          <li>‏• صلاحيات مفصّلة لكل دور، وفحصها في طبقة الخدمات لا في الواجهة.</li>
          <li>‏• سجل تدقيق مُسلسَل بالبصمات لكشف أي تعديل.</li>
          <li>‏• حركات المخزون بنظام FIFO داخل معاملات آمنة.</li>
        </ul>
        <div className="text-xs text-white/60">الإصدار 0.1.0 — نسخة سطح مكتب</div>
      </div>

      <div className="flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <div>
            <h1 className="text-2xl font-bold">تسجيل الدخول</h1>
            <p className="mt-1 text-sm text-muted">أدخل بيانات حسابك للمتابعة.</p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl bg-danger-50 px-3 py-2.5 text-sm font-semibold text-danger-700"
            >
              {error}
            </div>
          )}

          <div>
            <label className="label" htmlFor="username">
              اسم المستخدم
            </label>
            <input
              id="username"
              className="field"
              autoComplete="username"
              autoFocus
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="password">
              كلمة المرور
            </label>
            <input
              id="password"
              type="password"
              className="field"
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? 'جارٍ التحقق…' : 'دخول'}
          </button>

          <p className="text-xs leading-relaxed text-muted">
            عند أول تشغيل يُنشأ حساب «admin» بكلمة مرور أولية، وتُحفظ في ملف
            <span className="mx-1 font-mono">first-run-admin-password.txt</span>
            داخل مجلد بيانات التطبيق، ويجب تغييرها فورًا.
          </p>
        </form>
      </div>
    </div>
  );
}
