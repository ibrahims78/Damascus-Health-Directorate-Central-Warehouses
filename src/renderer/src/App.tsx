import { useCallback, useEffect, useState } from 'react';
import type { SessionUser } from './global';
import LoginScreen from './screens/LoginScreen';
import DashboardScreen from './screens/DashboardScreen';

export default function App(): React.ReactElement {
  const [session, setSession] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwForm, setPwForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await window.whsham.auth.me();
      if (res.ok && res.data) setSession(res.data);
      setBooting(false);
    })();
  }, []);

  const handleLogout = useCallback(async () => {
    await window.whsham.auth.logout();
    setSession(null);
  }, []);

  const submitPassword = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setPwError(null);
      if (pwForm.newPassword !== pwForm.confirm) {
        setPwError('كلمتا المرور غير متطابقتين.');
        return;
      }
      setPwBusy(true);
      const res = await window.whsham.auth.changePassword(pwForm.oldPassword, pwForm.newPassword);
      setPwBusy(false);
      if (!res.ok) {
        setPwError(res.message);
        return;
      }
      setPwForm({ oldPassword: '', newPassword: '', confirm: '' });
      setSession((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
    },
    [pwForm],
  );

  if (booting) {
    return (
      <div className="flex h-full items-center justify-center text-muted">جارٍ تهيئة التطبيق…</div>
    );
  }

  if (!session) return <LoginScreen onSignedIn={setSession} />;

  if (session.mustChangePassword) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <form onSubmit={submitPassword} className="card w-full max-w-md space-y-4 p-7">
          <div>
            <h1 className="text-xl font-bold">تعيين كلمة مرور جديدة</h1>
            <p className="mt-1 text-sm text-muted">
              هذه أول مرة تسجّل فيها الدخول، يجب تغيير كلمة المرور الأولية قبل المتابعة.
            </p>
          </div>

          {pwError && (
            <div className="rounded-xl bg-danger-50 px-3 py-2.5 text-sm font-semibold text-danger-700">
              {pwError}
            </div>
          )}

          <div>
            <label className="label" htmlFor="oldPassword">
              كلمة المرور الحالية
            </label>
            <input
              id="oldPassword"
              type="password"
              className="field"
              autoComplete="current-password"
              value={pwForm.oldPassword}
              onChange={(e) => setPwForm({ ...pwForm, oldPassword: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="newPassword">
              كلمة المرور الجديدة (10 محارف على الأقل)
            </label>
            <input
              id="newPassword"
              type="password"
              className="field"
              autoComplete="new-password"
              minLength={10}
              value={pwForm.newPassword}
              onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="confirmPassword">
              تأكيد كلمة المرور
            </label>
            <input
              id="confirmPassword"
              type="password"
              className="field"
              autoComplete="new-password"
              minLength={10}
              value={pwForm.confirm}
              onChange={(e) => setPwForm({ ...pwForm, confirm: e.target.value })}
              required
            />
          </div>

          <div className="flex items-center justify-between pt-1">
            <button type="submit" className="btn-primary" disabled={pwBusy}>
              {pwBusy ? 'جارٍ الحفظ…' : 'حفظ ومتابعة'}
            </button>
            <button type="button" className="btn-ghost" onClick={handleLogout}>
              تسجيل الخروج
            </button>
          </div>
        </form>
      </div>
    );
  }

  return <DashboardScreen session={session} onLogout={handleLogout} />;
}
