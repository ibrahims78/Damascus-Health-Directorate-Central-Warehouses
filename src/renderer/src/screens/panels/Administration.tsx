import { useMemo, useState } from 'react';
import type { AppSettings, AuditRow, BackupRow, RoleRow, SessionUser, UserRow } from '../../global';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  Empty,
  Field,
  Loading,
  SectionTitle,
  Select,
  useAsync,
} from '../../components/ui';

/* ------------------------------- المستخدمون -------------------------------- */

const STATUS_LABELS: Record<string, string> = {
  active: 'مُفعَّل',
  pending: 'بانتظار التفعيل',
  disabled: 'معطَّل',
};

export function UsersPanel() {
  const users = useAsync(() => window.whsham.users.list());
  const roles = useAsync(() => window.whsham.users.roles());
  const warehouses = useAsync(() => window.whsham.warehouses.list());
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [form, setForm] = useState({ username: '', fullName: '', roleId: 'EndUser', jobTitle: '', phone: '', activate: true });

  const roleOptions = useMemo(
    () => (roles.data ?? []).map((r: RoleRow) => ({ value: r.id, label: r.titleAr })),
    [roles.data],
  );

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await window.whsham.users.create({
      username: form.username,
      fullName: form.fullName,
      roleId: form.roleId,
      jobTitle: form.jobTitle || null,
      phone: form.phone || null,
      activate: form.activate,
    });
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({
      kind: 'ok',
      text: `تم إنشاء الحساب. كلمة المرور المؤقتة: ${result.data.temporaryPassword} — يجب تغييرها عند أول دخول.`,
    });
    setForm({ username: '', fullName: '', roleId: 'EndUser', jobTitle: '', phone: '', activate: true });
    users.reload();
  };

  const toggleStatus = async (row: UserRow) => {
    const next = row.status === 'active' ? 'disabled' : 'active';
    const result = await window.whsham.users.setStatus({ userId: row.id, status: next });
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: 'تم تحديث حالة الحساب.' });
    users.reload();
  };

  const resetPassword = async (row: UserRow) => {
    const result = await window.whsham.users.resetPassword(row.id);
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: `كلمة المرور المؤقتة الجديدة لـ ${row.username}: ${result.data.temporaryPassword}` });
  };

  const changeRole = async (row: UserRow, roleId: string) => {
    const result = await window.whsham.users.setRole({ userId: row.id, roleId, warehouseIds: [] });
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: 'تم تحديث الدور.' });
    users.reload();
  };

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_400px]">
      <div className="space-y-4">
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        {users.error && <Alert kind="err">{users.error}</Alert>}
        {users.loading && !users.data ? (
          <Loading />
        ) : (
          <DataTable headers={['الاسم', 'اسم المستخدم', 'الدور', 'الوظيفة', 'الحالة', 'إجراءات']} dense>
            {(users.data ?? []).map((row: UserRow) => (
              <tr key={row.id}>
                <td className="font-semibold">{row.fullName}</td>
                <td className="font-mono text-xs">{row.username}</td>
                <td>
                  <select
                    className="rounded-lg border border-line bg-surface px-2 py-1 text-xs"
                    value={row.role}
                    onChange={(e) => void changeRole(row, e.target.value)}
                  >
                    {(roles.data ?? []).map((r: RoleRow) => (
                      <option key={r.id} value={r.id}>
                        {r.titleAr}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{row.jobTitle ?? '—'}</td>
                <td>
                  {row.status === 'active' ? (
                    <Badge kind="ok">{STATUS_LABELS['active']}</Badge>
                  ) : row.status === 'pending' ? (
                    <Badge kind="warn">{STATUS_LABELS['pending']}</Badge>
                  ) : (
                    <Badge kind="muted">{STATUS_LABELS['disabled']}</Badge>
                  )}
                </td>
                <td>
                  <div className="flex flex-wrap gap-1.5">
                    <Button variant="ghost" onClick={() => void toggleStatus(row)}>
                      {row.status === 'active' ? 'تعطيل' : 'تفعيل'}
                    </Button>
                    <Button variant="ghost" onClick={() => void resetPassword(row)}>
                      تصفير كلمة المرور
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {(users.data ?? []).length === 0 && <Empty text="لا يوجد مستخدمون." colSpan={6} />}
          </DataTable>
        )}

        <Card className="p-5">
          <SectionTitle title="مصفوفة الصلاحيات" hint="مصدر الحقيقة الوحيد للأذونات — الإنكار ضمني لأي صلاحية غير مذكورة." />
          <div className="space-y-3">
            {(roles.data ?? []).map((role: RoleRow) => (
              <div key={role.id} className="rounded-xl border border-line p-3">
                <div className="text-sm font-bold">
                  {role.titleAr} <span className="text-xs text-muted">({role.id})</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {role.permissions.slice(0, 12).map((permission) => (
                    <span key={permission} className="badge bg-canvas text-muted">
                      {permission}
                    </span>
                  ))}
                  {role.permissions.length > 12 && (
                    <span className="badge bg-canvas text-muted">+{role.permissions.length - 12}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <SectionTitle title="إنشاء حساب" hint="يُنشأ معطَّلًا أو مُفعَّلًا حسب اختيارك، وكلمة المرور تُعرض مرة واحدة." />
        <form className="space-y-3" onSubmit={create}>
          <Field label="اسم المستخدم *" value={form.username} onChange={(v) => setForm({ ...form, username: v })} required />
          <Field label="الاسم الكامل *" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} required />
          <Select label="الدور" value={form.roleId} onChange={(v) => setForm({ ...form, roleId: v })} options={roleOptions} />
          <Field label="الوظيفة" value={form.jobTitle} onChange={(v) => setForm({ ...form, jobTitle: v })} />
          <Field label="الهاتف" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={form.activate} onChange={(e) => setForm({ ...form, activate: e.target.checked })} />
            تفعيل الحساب فورًا
          </label>
          <Button type="submit" className="w-full">
            إنشاء الحساب
          </Button>
          <p className="text-xs text-muted">
            عدد المستودعات المتاحة: {(warehouses.data ?? []).length} — تُسنَد صلاحيات المستودعات من شاشة الصلاحيات.
          </p>
        </form>
      </Card>
    </section>
  );
}

/* --------------------------------- التقارير -------------------------------- */

const REPORT_OPTIONS = [
  { value: 'stock_summary', label: 'تقرير الأرصدة' },
  { value: 'movements', label: 'سجل الحركات' },
  { value: 'below_min', label: 'المواد تحت الحد الأدنى' },
  { value: 'expiring_soon', label: 'الدفعات القريبة الانتهاء' },
  { value: 'custody_open', label: 'العهد الشخصية المفتوحة' },
  { value: 'audit_trail', label: 'سجل التدقيق' },
];

export function ReportsPanel() {
  const warehouses = useAsync(() => window.whsham.warehouses.list());
  const [kind, setKind] = useState('stock_summary');
  const [warehouseId, setWarehouseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [days, setDays] = useState('90');
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const payload = () => ({
    kind,
    warehouseId: warehouseId || null,
    from: from || null,
    to: to || null,
    days: Number(days) || null,
    limit: 5000,
  });

  const run = async () => {
    const result = await window.whsham.reports.run(payload());
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setRows(result.data);
    setNotice({ kind: 'ok', text: `تم توليد التقرير: ${result.data.length} سجل.` });
  };

  const exportCsv = async () => {
    const result = await window.whsham.reports.export(payload());
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: `تم التصدير إلى: ${result.data.file}` });
  };

  const headers = rows && rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [];

  return (
    <section className="space-y-5">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      <Card className="p-5">
        <SectionTitle title="مولّد التقارير" hint="التقارير تُقرأ من القاعدة المحلية فقط، والتصدير بصيغة CSV متوافقة مع Excel." />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <Select label="التقرير" value={kind} onChange={setKind} options={REPORT_OPTIONS} />
          <Select
            label="المستودع"
            value={warehouseId}
            onChange={setWarehouseId}
            options={(warehouses.data ?? []).map((w) => ({ value: w.id, label: w.name }))}
            placeholder="كل المستودعات"
          />
          <Field label="من تاريخ" type="date" value={from} onChange={setFrom} />
          <Field label="إلى تاريخ" type="date" value={to} onChange={setTo} />
          <Field label="خلال (أيام)" type="number" value={days} onChange={setDays} />
        </div>
        <div className="mt-4 flex gap-3">
          <Button onClick={() => void run()}>توليد التقرير</Button>
          <Button variant="ghost" onClick={() => void exportCsv()}>
            تصدير CSV
          </Button>
        </div>
      </Card>

      {rows === null ? (
        <Card className="p-6 text-center text-muted">اختر نوع التقرير ثم اضغط «توليد التقرير».</Card>
      ) : (
        <DataTable headers={headers.length ? headers : ['لا بيانات']} dense>
          {rows.length === 0 && <Empty text="لا توجد بيانات مطابقة." colSpan={Math.max(headers.length, 1)} />}
          {rows.map((row, index) => (
            <tr key={index}>
              {headers.map((header) => (
                <td key={header}>{row[header] === null || row[header] === undefined ? '—' : String(row[header])}</td>
              ))}
            </tr>
          ))}
        </DataTable>
      )}
    </section>
  );
}

/* ------------------------------- سجل التدقيق ------------------------------- */

export function AuditPanel() {
  const audit = useAsync(() => window.whsham.audit.list(300));
  const [chain, setChain] = useState<string | null>(null);
  const [chainOk, setChainOk] = useState(true);

  const verify = async () => {
    const result = await window.whsham.audit.verify();
    if (!result.ok) {
      setChain(result.message);
      setChainOk(false);
      return;
    }
    setChainOk(result.data.ok);
    setChain(
      result.data.ok
        ? `السلسلة سليمة — تم التحقق من ${result.data.checked} قيدًا.`
        : `تحذير: كُسرت السلسلة عند القيد رقم ${result.data.brokenAtSeq}.`,
    );
  };

  const exportAudit = async () => {
    await window.whsham.reports.export({ kind: 'audit_trail', limit: 5000 });
  };

  return (
    <section className="space-y-4">
      {chain && <Alert kind={chainOk ? 'ok' : 'err'}>{chain}</Alert>}
      {audit.error && <Alert kind="err">{audit.error}</Alert>}

      <div className="flex gap-3">
        <Button onClick={() => void verify()}>التحقق من سلامة السلسلة</Button>
        <Button variant="ghost" onClick={() => void exportAudit()}>
          تصدير سجل التدقيق
        </Button>
      </div>

      {audit.loading && !audit.data ? (
        <Loading />
      ) : (
        <DataTable headers={['#', 'الإجراء', 'الكيان', 'المعرّف', 'المستخدم', 'الوقت']} dense>
          {(audit.data ?? []).map((row: AuditRow) => (
            <tr key={row.seq}>
              <td>{row.seq}</td>
              <td className="font-semibold">{row.action}</td>
              <td>{row.entity}</td>
              <td className="font-mono text-xs">{row.entityId ?? '—'}</td>
              <td>{row.userName ?? '—'}</td>
              <td className="text-xs text-muted" dir="ltr">
                {new Date(row.createdAt).toLocaleString('ar-SY')}
              </td>
            </tr>
          ))}
          {(audit.data ?? []).length === 0 && <Empty text="لا توجد قيود." colSpan={6} />}
        </DataTable>
      )}
    </section>
  );
}

/* ----------------------------- النسخ الاحتياطي ------------------------------ */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BackupPanel() {
  const backups = useAsync(() => window.whsham.backup.list());
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const create = async () => {
    const result = await window.whsham.backup.create();
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: `تم إنشاء نسخة احتياطية (${formatBytes(result.data.sizeBytes)}).` });
    backups.reload();
  };

  const exportOne = async (row: BackupRow) => {
    const result = await window.whsham.backup.export(row.file);
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: `تم حفظ النسخة في: ${result.data.file}` });
  };

  const restore = async (row: BackupRow) => {
    const result = await window.whsham.backup.restore(row.file);
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: 'بدأت الاستعادة… سيُعاد تشغيل التطبيق تلقائيًا.' });
  };

  return (
    <section className="space-y-5">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {backups.error && <Alert kind="err">{backups.error}</Alert>}

      <Card className="p-5">
        <SectionTitle
          title="النسخ الاحتياطي"
          hint="تُنشأ النسخة بعد دمج سجل WAL وفحص سلامة القاعدة، وتُحفظ محليًا داخل مجلد بيانات التطبيق."
        />
        <Button onClick={() => void create()}>إنشاء نسخة احتياطية الآن</Button>
      </Card>

      {backups.loading && !backups.data ? (
        <Loading />
      ) : (
        <DataTable headers={['الملف', 'الحجم', 'التاريخ', 'إجراءات']}>
          {(backups.data ?? []).map((row: BackupRow) => (
            <tr key={row.file}>
              <td className="font-mono text-xs">{row.file.split(/[\\/]/).pop()}</td>
              <td>{formatBytes(row.sizeBytes)}</td>
              <td className="text-xs text-muted" dir="ltr">
                {new Date(row.createdAt).toLocaleString('ar-SY')}
              </td>
              <td>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => void exportOne(row)}>
                    حفظ نسخة خارجية
                  </Button>
                  <Button variant="danger" onClick={() => void restore(row)}>
                    استعادة
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {(backups.data ?? []).length === 0 && <Empty text="لا توجد نسخ احتياطية بعد." colSpan={4} />}
        </DataTable>
      )}
    </section>
  );
}

/* -------------------------------- الإعدادات -------------------------------- */

export function SettingsPanel({ session }: { session: SessionUser }) {
  const settings = useAsync(() => window.whsham.settings.get());
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const data = draft ?? settings.data;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!data) return;
    const result = await window.whsham.settings.set({
      org_name_ar: data['org_name_ar'] ?? '',
      org_name_en: data['org_name_en'] ?? '',
      org_address: data['org_address'] ?? '',
      org_phone: data['org_phone'] ?? '',
      fiscal_closed_until: data['fiscal_closed_until'] ?? '',
      low_stock_alert: data['low_stock_alert'] ?? '1',
      barcode_prefix: data['barcode_prefix'] ?? '',
    });
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setDraft(result.data);
    setNotice({ kind: 'ok', text: 'تم حفظ الإعدادات وتسجيلها في سجل التدقيق.' });
  };

  const set = (key: string, value: string) => setDraft({ ...(data ?? {}), [key]: value });

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card className="p-5">
        <SectionTitle title="بيانات الجهة" hint="تظهر في ترويسة التقارير والمطبوعات." />
        {settings.error && <Alert kind="err">{settings.error}</Alert>}
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        {!data ? (
          <Loading />
        ) : (
          <form className="space-y-3" onSubmit={save}>
            <Field label="اسم الجهة (عربي)" value={data['org_name_ar'] ?? ''} onChange={(v) => set('org_name_ar', v)} />
            <Field label="اسم الجهة (إنجليزي)" value={data['org_name_en'] ?? ''} onChange={(v) => set('org_name_en', v)} />
            <Field label="العنوان" value={data['org_address'] ?? ''} onChange={(v) => set('org_address', v)} />
            <Field label="الهاتف" value={data['org_phone'] ?? ''} onChange={(v) => set('org_phone', v)} />
            <Field label="بادئة الباركود" value={data['barcode_prefix'] ?? ''} onChange={(v) => set('barcode_prefix', v)} />
            <Field
              label="إغلاق السنة المالية حتى تاريخ"
              type="date"
              value={data['fiscal_closed_until'] ?? ''}
              onChange={(v) => set('fiscal_closed_until', v)}
              hint="لا تُقبل أي حركة بتاريخ أقدم من هذا التاريخ (رقابة على الفترات المُقفلة)."
            />
            <Button type="submit" className="w-full">
              حفظ الإعدادات
            </Button>
          </form>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle title="معلومات النظام" />
        <ul className="space-y-2 text-sm">
          <li>
            المستخدم الحالي: <b>{session.fullName}</b> ({session.role})
          </li>
          <li>نسخة التطبيق: 1.0.0</li>
          <li>قاعدة البيانات: SQLite محلية (WAL) — لا اتصال شبكي.</li>
          <li>تشفير الحقول الحساسة: AES-256-GCM بمفتاح محلي مُقيَّد الصلاحيات.</li>
          <li>سجل التدقيق: إضافة فقط (append-only) مع منع الحذف على مستوى القاعدة.</li>
        </ul>
      </Card>
    </section>
  );
}
