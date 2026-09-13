import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AuditRow,
  DashboardStats,
  MaterialRow,
  SessionUser,
  StockRow,
  WarehouseRow,
} from '../global';

type Tab = 'overview' | 'stock' | 'materials' | 'audit';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'لوحة المعلومات' },
  { id: 'stock', label: 'المخزون والحركات' },
  { id: 'materials', label: 'كتالوج المواد' },
  { id: 'audit', label: 'سجل التدقيق' },
];

export default function DashboardScreen({
  session,
  onLogout,
}: {
  session: SessionUser;
  onLogout: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [chain, setChain] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [query, setQuery] = useState('');

  const [flow, setFlow] = useState({
    materialId: '',
    warehouseId: '',
    quantity: '',
    batchNumber: '',
    expiryDate: '',
    entryNumber: '',
  });

  const [newMaterial, setNewMaterial] = useState({ code: '', name: '', unit: '', minStock: '0' });

  const say = useCallback((kind: 'ok' | 'err', text: string) => {
    setNotice({ kind, text });
    window.setTimeout(() => setNotice(null), 5000);
  }, []);

  const refresh = useCallback(async () => {
    const [s, st, m, w] = await Promise.all([
      window.whsham.dashboard.stats(),
      window.whsham.inventory.stock({ query: query || null }),
      window.whsham.materials.list(),
      window.whsham.warehouses.list(),
    ]);
    if (s.ok) setStats(s.data);
    if (st.ok) setStock(st.data);
    if (m.ok) setMaterials(m.data);
    if (w.ok) {
      setWarehouses(w.data);
      setFlow((prev) => ({
        ...prev,
        warehouseId: prev.warehouseId || w.data[0]?.id || '',
        materialId: prev.materialId || m.ok ? prev.materialId || m.data[0]?.id || '' : '',
      }));
    }
  }, [query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadAudit = useCallback(async () => {
    const res = await window.whsham.audit.list(150);
    if (res.ok) setAudit(res.data);
    const v = await window.whsham.audit.verify();
    if (v.ok) {
      setChain(
        v.data.ok
          ? `السلسلة سليمة — تم التحقق من ${v.data.checked} قيدًا.`
          : `تحذير: تم كسر السلسلة عند القيد رقم ${v.data.brokenAtSeq}.`,
      );
    }
  }, []);

  useEffect(() => {
    if (tab === 'audit') void loadAudit();
  }, [tab, loadAudit]);

  const submitMovement = async (kind: 'receive' | 'issue') => {
    const quantity = Number(flow.quantity);
    if (!flow.materialId || !flow.warehouseId || !Number.isInteger(quantity) || quantity <= 0) {
      say('err', 'يرجى اختيار المادة والمستودع وإدخال كمية صحيحة.');
      return;
    }
    const payload =
      kind === 'receive'
        ? {
            materialId: flow.materialId,
            warehouseId: flow.warehouseId,
            quantity,
            batchNumber: flow.batchNumber || null,
            expiryDate: flow.expiryDate || null,
            entryNumber: flow.entryNumber || null,
          }
        : { materialId: flow.materialId, warehouseId: flow.warehouseId, quantity };

    const res =
      kind === 'receive'
        ? await window.whsham.inventory.receive(payload)
        : await window.whsham.inventory.issue(payload);

    if (!res.ok) {
      say('err', res.message);
      return;
    }
    say('ok', kind === 'receive' ? `تم الإدخال. الرصيد الجديد: ${res.data.balance}` : `تم الإخراج. الرصيد المتبقي: ${res.data.balance}`);
    setFlow({ ...flow, quantity: '', batchNumber: '', expiryDate: '', entryNumber: '' });
    void refresh();
  };

  const createMaterial = async (event: React.FormEvent) => {
    event.preventDefault();
    const res = await window.whsham.materials.create({
      code: newMaterial.code,
      name: newMaterial.name,
      unit: newMaterial.unit,
      minStock: Number(newMaterial.minStock) || 0,
    });
    if (!res.ok) {
      say('err', res.message);
      return;
    }
    say('ok', 'تمت إضافة المادة إلى الكتالوج.');
    setNewMaterial({ code: '', name: '', unit: '', minStock: '0' });
    void refresh();
  };

  const statCards = useMemo(
    () => [
      { label: 'المواد المُفعَّلة', value: stats?.materials ?? '—' },
      { label: 'المستودعات', value: stats?.warehouses ?? '—' },
      { label: 'إجمالي الكميات', value: stats?.totalQuantity ?? '—' },
      { label: 'مواد تحت الحد الأدنى', value: stats?.belowMin ?? '—', tone: (stats?.belowMin ?? 0) > 0 },
      { label: 'حركات آخر 24 ساعة', value: stats?.movementsToday ?? '—' },
    ],
    [stats],
  );

  return (
    <div className="flex h-full">
      <aside className="flex w-64 flex-col border-l border-line bg-surface p-5">
        <div className="text-lg font-bold text-brand-500">WHSHAM</div>
        <div className="mt-1 text-xs text-muted">إدارة المستودعات المركزي</div>

        <nav className="mt-7 space-y-1.5">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`w-full rounded-xl px-3 py-2.5 text-right text-sm font-semibold transition ${
                tab === item.id ? 'bg-brand-500 text-white' : 'text-ink hover:bg-canvas'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto border-t border-line pt-4 text-xs text-muted">
          <div className="font-semibold text-ink">{session.fullName}</div>
          <div>{session.role}</div>
          <button className="btn-ghost mt-3 w-full" onClick={onLogout}>
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-7">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{TABS.find((t) => t.id === tab)?.label}</h1>
            <p className="mt-1 text-sm text-muted">بيانات محلية على هذا الجهاز — لا تُرسل إلى أي خدمة خارجية.</p>
          </div>
          <input
            className="field max-w-xs"
            placeholder="بحث في المخزون…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </header>

        {notice && (
          <div
            role="status"
            className={`mb-5 rounded-xl px-4 py-3 text-sm font-semibold ${
              notice.kind === 'ok' ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'
            }`}
          >
            {notice.text}
          </div>
        )}

        {tab === 'overview' && (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {statCards.map((card) => (
              <div key={card.label} className="card p-5">
                <div className="text-sm text-muted">{card.label}</div>
                <div
                  className={`mt-2 text-3xl font-bold ${
                    card.tone ? 'text-danger-500' : 'text-brand-500'
                  }`}
                >
                  {card.value}
                </div>
              </div>
            ))}
          </section>
        )}

        {tab === 'stock' && (
          <section className="space-y-6">
            <div className="card p-5">
              <h2 className="mb-4 text-lg font-bold">حركة مخزون</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <select
                  className="field"
                  value={flow.materialId}
                  onChange={(e) => setFlow({ ...flow, materialId: e.target.value })}
                >
                  <option value="">— اختر المادة —</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.code})
                    </option>
                  ))}
                </select>

                <select
                  className="field"
                  value={flow.warehouseId}
                  onChange={(e) => setFlow({ ...flow, warehouseId: e.target.value })}
                >
                  <option value="">— اختر المستودع —</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>

                <input
                  className="field"
                  inputMode="numeric"
                  placeholder="الكمية"
                  value={flow.quantity}
                  onChange={(e) => setFlow({ ...flow, quantity: e.target.value })}
                />

                <input
                  className="field"
                  placeholder="رقم الدفعة (اختياري)"
                  value={flow.batchNumber}
                  onChange={(e) => setFlow({ ...flow, batchNumber: e.target.value })}
                />
                <input
                  className="field"
                  type="date"
                  value={flow.expiryDate}
                  onChange={(e) => setFlow({ ...flow, expiryDate: e.target.value })}
                />
                <input
                  className="field"
                  placeholder="رقم الإدخال (اختياري)"
                  value={flow.entryNumber}
                  onChange={(e) => setFlow({ ...flow, entryNumber: e.target.value })}
                />
              </div>

              <div className="mt-4 flex gap-3">
                <button className="btn-primary" onClick={() => void submitMovement('receive')}>
                  إدخال
                </button>
                <button className="btn-ghost" onClick={() => void submitMovement('issue')}>
                  إخراج (FIFO)
                </button>
              </div>
            </div>

            <div className="card overflow-hidden">
              <table className="table">
                <thead>
                  <tr>
                    <th>الرمز</th>
                    <th>المادة</th>
                    <th>المستودع</th>
                    <th>الرصيد</th>
                    <th>الحد الأدنى</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {stock.map((row) => (
                    <tr key={`${row.materialId}-${row.warehouseId}`}>
                      <td className="font-mono text-xs">{row.code}</td>
                      <td>{row.materialName}</td>
                      <td>{row.warehouseName}</td>
                      <td className="font-semibold">{row.quantity}</td>
                      <td>{row.minStock}</td>
                      <td>
                        {row.quantity <= row.minStock ? (
                          <span className="badge bg-danger-50 text-danger-700">تحت الحد</span>
                        ) : (
                          <span className="badge bg-success-50 text-success-700">جيد</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {stock.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted">
                        لا توجد أرصدة مسجَّلة بعد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'materials' && (
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
            <div className="card overflow-hidden">
              <table className="table">
                <thead>
                  <tr>
                    <th>الرمز</th>
                    <th>الاسم</th>
                    <th>الوحدة</th>
                    <th>الحد الأدنى</th>
                    <th>الباركود</th>
                  </tr>
                </thead>
                <tbody>
                  {materials.map((m) => (
                    <tr key={m.id}>
                      <td className="font-mono text-xs">{m.code}</td>
                      <td>{m.name}</td>
                      <td>{m.unit}</td>
                      <td>{m.minStock}</td>
                      <td className="font-mono text-xs">{m.barcode ?? '—'}</td>
                    </tr>
                  ))}
                  {materials.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted">
                        الكتالوج فارغ.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <form onSubmit={createMaterial} className="card space-y-3 p-5">
              <h2 className="text-lg font-bold">إضافة مادة</h2>
              <input
                className="field"
                placeholder="الرمز *"
                value={newMaterial.code}
                onChange={(e) => setNewMaterial({ ...newMaterial, code: e.target.value })}
                required
              />
              <input
                className="field"
                placeholder="اسم المادة *"
                value={newMaterial.name}
                onChange={(e) => setNewMaterial({ ...newMaterial, name: e.target.value })}
                required
              />
              <input
                className="field"
                placeholder="الوحدة (علبة/كرتون…) *"
                value={newMaterial.unit}
                onChange={(e) => setNewMaterial({ ...newMaterial, unit: e.target.value })}
                required
              />
              <input
                className="field"
                inputMode="numeric"
                placeholder="الحد الأدنى"
                value={newMaterial.minStock}
                onChange={(e) => setNewMaterial({ ...newMaterial, minStock: e.target.value })}
              />
              <button type="submit" className="btn-primary w-full">
                حفظ المادة
              </button>
            </form>
          </section>
        )}

        {tab === 'audit' && (
          <section className="space-y-5">
            {chain && (
              <div
                className={`rounded-xl px-4 py-3 text-sm font-semibold ${
                  chain.startsWith('السلسلة') ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'
                }`}
              >
                {chain}
              </div>
            )}
            <div className="card overflow-hidden">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>الإجراء</th>
                    <th>الكيان</th>
                    <th>المستخدم</th>
                    <th>الوقت</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((row) => (
                    <tr key={row.seq}>
                      <td>{row.seq}</td>
                      <td className="font-semibold">{row.action}</td>
                      <td>{row.entity}</td>
                      <td>{row.userName ?? '—'}</td>
                      <td className="text-xs text-muted" dir="ltr">
                        {new Date(row.createdAt).toLocaleString('ar-SY')}
                      </td>
                    </tr>
                  ))}
                  {audit.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted">
                        لا توجد قيود بعد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
