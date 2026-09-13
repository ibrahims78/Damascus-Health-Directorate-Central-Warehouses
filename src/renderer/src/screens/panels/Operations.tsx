import { useMemo, useState } from 'react';
import type {
  CustodyRow,
  MaterialRow,
  NoticeRow,
  SessionUser,
  StockRow,
  SupplierRow,
  WarehouseRow,
} from '../../global';
import { Alert, Badge, Button, Card, DataTable, Empty, Field, Loading, SectionTitle, Select, useAsync } from '../../components/ui';
import BarcodeScanner from '../../components/BarcodeScanner';

function useOptions(rows: WarehouseRow[] | null) {
  return useMemo(
    () => (rows ?? []).map((row) => ({ value: row.id, label: row.name })),
    [rows],
  );
}

/* ------------------------------- لوحة المعلومات ------------------------------ */

export function OverviewPanel() {
  const stats = useAsync(() => window.whsham.dashboard.stats());
  const s = stats.data;

  return (
    <section className="space-y-5">
      {stats.error && <Alert kind="err">{stats.error}</Alert>}
      {stats.loading && !s ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="المواد المُفعَّلة" value={s?.materials ?? 0} />
          <Stat label="المستودعات" value={s?.warehouses ?? 0} />
          <Stat label="إجمالي الكميات" value={s?.totalQuantity ?? 0} />
          <Stat label="مواد تحت الحد الأدنى" value={s?.belowMin ?? 0} tone={(s?.belowMin ?? 0) > 0 ? 'danger' : 'ok'} />
          <Stat label="حركات آخر 24 ساعة" value={s?.movementsToday ?? 0} />
          <Stat label="عهد شخصية مفتوحة" value={s?.openCustody ?? 0} tone={(s?.openCustody ?? 0) > 0 ? 'warn' : 'ok'} />
          <Stat label="دفعات تنتهي خلال 90 يومًا" value={s?.expiringSoon ?? 0} tone={(s?.expiringSoon ?? 0) > 0 ? 'warn' : 'ok'} />
        </div>
      )}

      <Card className="p-5">
        <SectionTitle
          title="ملاحظات تشغيلية"
          hint="هذه النسخة تعمل محليًا بالكامل على هذا الجهاز: لا تُرسل أي بيانات إلى أي خدمة خارجية."
        />
        <ul className="space-y-2 text-sm text-muted">
          <li>• كل حركة مخزون تُسجَّل في سجل التدقيق بسلسلة بصمات يمكن التحقق منها.</li>
          <li>• لا يمكن أن يصبح الرصيد سالبًا: القاعدة ترفض العملية كاملة.</li>
          <li>• الإخراج يعمل بنظام FIFO (الأقرب انتهاءً أولًا) تلقائيًا.</li>
        </ul>
      </Card>
    </section>
  );
}

function Stat({ label, value, tone = 'brand' }: { label: string; value: number; tone?: 'brand' | 'danger' | 'warn' | 'ok' }) {
  const color = tone === 'danger' ? 'text-danger-500' : tone === 'warn' ? 'text-warn-500' : tone === 'ok' ? 'text-success-500' : 'text-brand-500';
  return (
    <div className="card p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

/* --------------------------------- المخزون --------------------------------- */

type MovementKind = 'receive' | 'issue' | 'transfer' | 'dispose' | 'adjust';

export function StockPanel({ session }: { session: SessionUser }) {
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [query, setQuery] = useState('');
  const [onlyBelowMin, setOnlyBelowMin] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [kind, setKind] = useState<MovementKind>('receive');

  const warehouses = useAsync(() => window.whsham.warehouses.list());
  const materials = useAsync(() => window.whsham.materials.list(null));
  const stock = useAsync(
    () => window.whsham.inventory.stock({ query: query || null, onlyBelowMin }),
    [query, onlyBelowMin],
  );

  const [form, setForm] = useState({
    materialId: '',
    warehouseId: '',
    toWarehouseId: '',
    quantity: '',
    batchNumber: '',
    expiryDate: '',
    entryNumber: '',
    recipient: '',
    reason: '',
  });

  const materialOptions = useMemo(
    () => (materials.data ?? []).map((m) => ({ value: m.id, label: `${m.name} (${m.code})` })),
    [materials.data],
  );
  const warehouseOptions = useOptions(warehouses.data);

  const reset = () =>
    setForm((prev) => ({ ...prev, quantity: '', batchNumber: '', expiryDate: '', entryNumber: '', recipient: '', reason: '' }));

  const submit = async () => {
    const quantity = Number(form.quantity);
    if (!form.materialId || !form.warehouseId || !Number.isInteger(quantity) || quantity <= 0) {
      setNotice({ kind: 'err', text: 'يرجى اختيار المادة والمستودع وإدخال كمية صحيحة.' });
      return;
    }

    let result;
    if (kind === 'receive') {
      result = await window.whsham.inventory.receive({
        materialId: form.materialId,
        warehouseId: form.warehouseId,
        quantity,
        batchNumber: form.batchNumber || null,
        expiryDate: form.expiryDate || null,
        entryNumber: form.entryNumber || null,
      });
    } else if (kind === 'issue') {
      result = await window.whsham.inventory.issue({
        materialId: form.materialId,
        warehouseId: form.warehouseId,
        quantity,
        recipient: form.recipient || null,
      });
    } else if (kind === 'transfer') {
      if (!form.toWarehouseId) {
        setNotice({ kind: 'err', text: 'يرجى اختيار المستودع الهدف.' });
        return;
      }
      result = await window.whsham.inventory.transfer({
        materialId: form.materialId,
        fromWarehouseId: form.warehouseId,
        toWarehouseId: form.toWarehouseId,
        quantity,
      });
    } else if (kind === 'dispose') {
      if (!form.reason) {
        setNotice({ kind: 'err', text: 'يرجى إدخال سبب الإتلاف.' });
        return;
      }
      result = await window.whsham.inventory.dispose({
        materialId: form.materialId,
        warehouseId: form.warehouseId,
        quantity,
        reason: form.reason,
      });
    } else {
      if (!form.reason) {
        setNotice({ kind: 'err', text: 'يرجى إدخال سبب التسوية.' });
        return;
      }
      result = await window.whsham.inventory.adjust({
        materialId: form.materialId,
        warehouseId: form.warehouseId,
        countedQuantity: quantity,
        reason: form.reason,
      });
    }

    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: 'تم تنفيذ العملية وتسجيلها في سجل التدقيق.' });
    reset();
    stock.reload();
  };

  const handleCode = async (code: string) => {
    const found = await window.whsham.inventory.findByBarcode(code);
    if (!found.ok || !found.data) {
      setNotice({ kind: 'err', text: `لا توجد مادة بهذا الرمز: ${code}` });
      return;
    }
    setForm((prev) => ({ ...prev, materialId: found.data!.id }));
    setNotice({ kind: 'ok', text: `تم تحديد المادة: ${found.data.name}` });
  };

  const labels: Record<MovementKind, string> = {
    receive: 'إدخال',
    issue: 'إخراج (FIFO)',
    transfer: 'نقل بين مستودعين',
    dispose: 'إتلاف',
    adjust: 'تسوية جرد',
  };

  return (
    <section className="space-y-6">
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
      {(stock.error || warehouses.error || materials.error) && (
        <Alert kind="err">{stock.error ?? warehouses.error ?? materials.error}</Alert>
      )}

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SectionTitle title="حركة مخزون" hint="كل عملية تُنفَّذ في قاعدة البيانات داخل معاملة واحدة." />
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setScanOpen(true)}>
              مسح باركود
            </Button>
            {(Object.keys(labels) as MovementKind[]).map((item) => (
              <Button key={item} variant={kind === item ? 'primary' : 'ghost'} onClick={() => setKind(item)}>
                {labels[item]}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Select
            label="المادة"
            value={form.materialId}
            onChange={(value) => setForm({ ...form, materialId: value })}
            options={materialOptions}
            placeholder="— اختر المادة —"
          />
          <Select
            label={kind === 'transfer' ? 'من مستودع' : 'المستودع'}
            value={form.warehouseId}
            onChange={(value) => setForm({ ...form, warehouseId: value })}
            options={warehouseOptions}
            placeholder="— اختر المستودع —"
          />
          {kind === 'transfer' && (
            <Select
              label="إلى مستودع"
              value={form.toWarehouseId}
              onChange={(value) => setForm({ ...form, toWarehouseId: value })}
              options={warehouseOptions}
              placeholder="— اختر المستودع الهدف —"
            />
          )}

          <Field
            label={kind === 'adjust' ? 'الكمية الفعلية بعد الجرد' : 'الكمية'}
            value={form.quantity}
            onChange={(value) => setForm({ ...form, quantity: value })}
            type="number"
            required
          />

          {kind === 'receive' && (
            <>
              <Field label="رقم الدفعة" value={form.batchNumber} onChange={(v) => setForm({ ...form, batchNumber: v })} />
              <Field label="تاريخ الصلاحية" type="date" value={form.expiryDate} onChange={(v) => setForm({ ...form, expiryDate: v })} />
              <Field label="رقم الإدخال" value={form.entryNumber} onChange={(v) => setForm({ ...form, entryNumber: v })} />
            </>
          )}

          {kind === 'issue' && (
            <Field label="المستلم" value={form.recipient} onChange={(v) => setForm({ ...form, recipient: v })} />
          )}

          {(kind === 'dispose' || kind === 'adjust') && (
            <Field
              label={kind === 'dispose' ? 'سبب الإتلاف' : 'سبب التسوية'}
              value={form.reason}
              onChange={(v) => setForm({ ...form, reason: v })}
              required
            />
          )}
        </div>

        <div className="mt-4">
          <Button onClick={() => void submit()}>تنفيذ: {labels[kind]}</Button>
        </div>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <Field label="بحث في الأرصدة" value={query} onChange={setQuery} placeholder="اسم المادة أو الرمز" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm font-semibold">
          <input type="checkbox" checked={onlyBelowMin} onChange={(e) => setOnlyBelowMin(e.target.checked)} />
          تحت الحد الأدنى فقط
        </label>
      </div>

      {stock.loading && !stock.data ? (
        <Loading />
      ) : (
        <DataTable headers={['الرمز', 'المادة', 'المستودع', 'الرصيد', 'الحد الأدنى', 'الحالة']}>
          {(stock.data ?? []).map((row: StockRow) => (
            <tr key={`${row.materialId}-${row.warehouseId}`}>
              <td className="font-mono text-xs">{row.code}</td>
              <td>{row.materialName}</td>
              <td>{row.warehouseName}</td>
              <td className="font-semibold">{row.quantity}</td>
              <td>{row.minStock}</td>
              <td>
                {row.quantity <= row.minStock ? (
                  <Badge kind="danger">تحت الحد</Badge>
                ) : row.quantity <= row.minStock * 1.5 ? (
                  <Badge kind="warn">قريب من الحد</Badge>
                ) : (
                  <Badge kind="ok">جيد</Badge>
                )}
              </td>
            </tr>
          ))}
          {(stock.data ?? []).length === 0 && <Empty text="لا توجد أرصدة مطابقة." colSpan={6} />}
        </DataTable>
      )}

      {scanOpen && <BarcodeScanner onDetected={(code) => void handleCode(code)} onClose={() => setScanOpen(false)} />}
    </section>
  );
}

/* --------------------------------- الكتالوج -------------------------------- */

export function CatalogPanel() {
  const materials = useAsync(() => window.whsham.materials.list(null));
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [form, setForm] = useState({
    code: '',
    name: '',
    unit: '',
    category: '',
    classification: '',
    type: '',
    minStock: '0',
    barcode: '',
  });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await window.whsham.materials.create({
      code: form.code,
      name: form.name,
      unit: form.unit,
      category: form.category || null,
      classification: form.classification || null,
      type: form.type || null,
      minStock: Number(form.minStock) || 0,
      barcode: form.barcode || null,
    });
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: 'تمت إضافة المادة.' });
    setForm({ code: '', name: '', unit: '', category: '', classification: '', type: '', minStock: '0', barcode: '' });
    materials.reload();
  };

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        {materials.error && <Alert kind="err">{materials.error}</Alert>}
        {materials.loading && !materials.data ? (
          <Loading />
        ) : (
          <DataTable headers={['الرمز', 'الاسم', 'الوحدة', 'التصنيف', 'الحد الأدنى', 'الرصيد الكلي', 'الباركود']}>
            {(materials.data ?? []).map((m: MaterialRow) => (
              <tr key={m.id}>
                <td className="font-mono text-xs">{m.code}</td>
                <td>{m.name}</td>
                <td>{m.unit}</td>
                <td>{m.classification ?? m.category ?? '—'}</td>
                <td>{m.minStock}</td>
                <td className="font-semibold">{m.totalQuantity}</td>
                <td className="font-mono text-xs">{m.barcode ?? '—'}</td>
              </tr>
            ))}
            {(materials.data ?? []).length === 0 && <Empty text="الكتالوج فارغ." colSpan={7} />}
          </DataTable>
        )}
      </div>

      <Card className="p-5">
        <SectionTitle title="إضافة مادة" hint="الرمز والباركود فريدان على مستوى النظام." />
        <form className="space-y-3" onSubmit={save}>
          <Field label="الرمز *" value={form.code} onChange={(v) => setForm({ ...form, code: v })} required />
          <Field label="اسم المادة *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
          <Field label="الوحدة *" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} required placeholder="علبة / كرتون / قطعة" />
          <Field label="التصنيف" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
          <Field label="التصنيف الفرعي" value={form.classification} onChange={(v) => setForm({ ...form, classification: v })} />
          <Field label="النوع" value={form.type} onChange={(v) => setForm({ ...form, type: v })} placeholder="دائم / مستهلك" />
          <Field label="الحد الأدنى" type="number" value={form.minStock} onChange={(v) => setForm({ ...form, minStock: v })} />
          <Field label="الباركود" value={form.barcode} onChange={(v) => setForm({ ...form, barcode: v })} />
          <Button type="submit" className="w-full">
            حفظ المادة
          </Button>
        </form>
      </Card>
    </section>
  );
}

/* -------------------------------- المستودعات ------------------------------- */

export function WarehousesPanel() {
  const warehouses = useAsync(() => window.whsham.warehouses.list());
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [form, setForm] = useState({ name: '', type: 'مركزية', category: '', location: '', capacity: '0' });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await window.whsham.warehouses.save({
      name: form.name,
      type: form.type,
      category: form.category || null,
      location: form.location || null,
      capacity: Number(form.capacity) || 0,
    });
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: 'تم حفظ المستودع.' });
    setForm({ name: '', type: 'مركزية', category: '', location: '', capacity: '0' });
    warehouses.reload();
  };

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        {warehouses.error && <Alert kind="err">{warehouses.error}</Alert>}
        <DataTable headers={['الاسم', 'النوع', 'التصنيف', 'الموقع', 'السعة', 'الرصيد الكلي', 'الحالة']}>
          {(warehouses.data ?? []).map((w: WarehouseRow) => (
            <tr key={w.id}>
              <td className="font-semibold">{w.name}</td>
              <td>{w.type}</td>
              <td>{w.category ?? '—'}</td>
              <td>{w.location ?? '—'}</td>
              <td>{w.capacity}</td>
              <td className="font-semibold">{w.totalQuantity}</td>
              <td>{w.status === 'active' ? <Badge kind="ok">فعّال</Badge> : <Badge kind="muted">موقوف</Badge>}</td>
            </tr>
          ))}
          {(warehouses.data ?? []).length === 0 && <Empty text="لا توجد مستودعات." colSpan={7} />}
        </DataTable>
      </div>

      <Card className="p-5">
        <SectionTitle title="إضافة مستودع" />
        <form className="space-y-3" onSubmit={save}>
          <Field label="الاسم *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
          <Select
            label="النوع"
            value={form.type}
            onChange={(v) => setForm({ ...form, type: v })}
            options={[
              { value: 'مركزية', label: 'مركزية' },
              { value: 'فرعية', label: 'فرعية' },
              { value: 'نقل', label: 'نقل' },
              { value: 'إتلاف', label: 'إتلاف' },
            ]}
          />
          <Field label="التصنيف" value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
          <Field label="الموقع" value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
          <Field label="السعة" type="number" value={form.capacity} onChange={(v) => setForm({ ...form, capacity: v })} />
          <Button type="submit" className="w-full">
            حفظ المستودع
          </Button>
        </form>
      </Card>
    </section>
  );
}

/* --------------------------------- المورّدون -------------------------------- */

export function SuppliersPanel() {
  const suppliers = useAsync(() => window.whsham.suppliers.list());
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [form, setForm] = useState({ name: '', contact: '', phone: '', address: '', sourceType: '' });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await window.whsham.suppliers.save({
      name: form.name,
      contact: form.contact || null,
      phone: form.phone || null,
      address: form.address || null,
      sourceType: form.sourceType || null,
    });
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: 'تم حفظ المورّد.' });
    setForm({ name: '', contact: '', phone: '', address: '', sourceType: '' });
    suppliers.reload();
  };

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        {suppliers.error && <Alert kind="err">{suppliers.error}</Alert>}
        <DataTable headers={['الاسم', 'جهة الاتصال', 'الهاتف', 'العنوان', 'نوع المصدر']}>
          {(suppliers.data ?? []).map((s: SupplierRow) => (
            <tr key={s.id}>
              <td className="font-semibold">{s.name}</td>
              <td>{s.contact ?? '—'}</td>
              <td dir="ltr">{s.phone ?? '—'}</td>
              <td>{s.address ?? '—'}</td>
              <td>{s.sourceType ?? '—'}</td>
            </tr>
          ))}
          {(suppliers.data ?? []).length === 0 && <Empty text="لا يوجد مورّدون." colSpan={5} />}
        </DataTable>
      </div>

      <Card className="p-5">
        <SectionTitle title="إضافة مورّد" />
        <form className="space-y-3" onSubmit={save}>
          <Field label="الاسم *" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
          <Field label="جهة الاتصال" value={form.contact} onChange={(v) => setForm({ ...form, contact: v })} />
          <Field label="الهاتف" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="العنوان" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
          <Field label="نوع المصدر" value={form.sourceType} onChange={(v) => setForm({ ...form, sourceType: v })} placeholder="منحة / شراء" />
          <Button type="submit" className="w-full">
            حفظ المورّد
          </Button>
        </form>
      </Card>
    </section>
  );
}

/* ---------------------------------- العهد ---------------------------------- */

export function CustodyPanel() {
  const custody = useAsync(() => window.whsham.custody.list(null));
  const warehouses = useAsync(() => window.whsham.warehouses.list());
  const materials = useAsync(() => window.whsham.materials.list(null));
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [form, setForm] = useState({
    materialId: '',
    warehouseId: '',
    custodianName: '',
    custodianJob: '',
    nationalId: '',
    quantity: '',
    notes: '',
  });

  const materialOptions = useMemo(
    () => (materials.data ?? []).map((m) => ({ value: m.id, label: `${m.name} (${m.code})` })),
    [materials.data],
  );
  const warehouseOptions = useOptions(warehouses.data);

  const assign = async (event: React.FormEvent) => {
    event.preventDefault();
    const quantity = Number(form.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setNotice({ kind: 'err', text: 'أدخل كمية صحيحة.' });
      return;
    }
    const result = await window.whsham.custody.assign({
      materialId: form.materialId,
      warehouseId: form.warehouseId,
      custodianName: form.custodianName,
      custodianJob: form.custodianJob || null,
      nationalId: form.nationalId || null,
      quantity,
      notes: form.notes || null,
    });
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: 'تم تسجيل العهدة وخصمها من المستودع.' });
    setForm({ materialId: '', warehouseId: '', custodianName: '', custodianJob: '', nationalId: '', quantity: '', notes: '' });
    custody.reload();
  };

  const returnBack = async (row: CustodyRow) => {
    const outstanding = row.quantity - row.quantityReturned;
    const result = await window.whsham.custody.returnBack({ custodyId: row.id, quantity: outstanding });
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: 'تم إرجاع العهدة إلى المستودع.' });
    custody.reload();
  };

  const reveal = async (row: CustodyRow) => {
    const result = await window.whsham.custody.revealId(row.id);
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: `الرقم الوطني: ${result.data.nationalId ?? '—'}` });
  };

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        {custody.error && <Alert kind="err">{custody.error}</Alert>}
        <DataTable headers={['العهدة', 'المادة', 'المستودع', 'الكمية', 'المُعاد', 'المتبقي', 'الحالة', 'إجراءات']}>
          {(custody.data ?? []).map((row: CustodyRow) => (
            <tr key={row.id}>
              <td>
                <div className="font-semibold">{row.custodianName}</div>
                <div className="text-xs text-muted">{row.custodianJob ?? '—'}</div>
              </td>
              <td>{row.materialName}</td>
              <td>{row.warehouseName}</td>
              <td>{row.quantity}</td>
              <td>{row.quantityReturned}</td>
              <td className="font-semibold">{row.quantity - row.quantityReturned}</td>
              <td>{row.status === 'active' ? <Badge kind="warn">مفتوحة</Badge> : <Badge kind="ok">مُغلقة</Badge>}</td>
              <td>
                <div className="flex flex-wrap gap-2">
                  {row.status === 'active' && (
                    <Button variant="ghost" onClick={() => void returnBack(row)}>
                      إرجاع
                    </Button>
                  )}
                  {row.hasNationalId === 1 && (
                    <Button variant="ghost" onClick={() => void reveal(row)}>
                      كشف الرقم الوطني
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {(custody.data ?? []).length === 0 && <Empty text="لا توجد عهد." colSpan={8} />}
        </DataTable>
      </div>

      <Card className="p-5">
        <SectionTitle title="تسجيل عهدة شخصية" hint="تُخصم الكمية من المستودع فورًا وتُعاد عند الإرجاع." />
        <form className="space-y-3" onSubmit={assign}>
          <Select
            label="المادة"
            value={form.materialId}
            onChange={(v) => setForm({ ...form, materialId: v })}
            options={materialOptions}
            placeholder="— اختر المادة —"
          />
          <Select
            label="المستودع"
            value={form.warehouseId}
            onChange={(v) => setForm({ ...form, warehouseId: v })}
            options={warehouseOptions}
            placeholder="— اختر المستودع —"
          />
          <Field label="اسم صاحب العهدة *" value={form.custodianName} onChange={(v) => setForm({ ...form, custodianName: v })} required />
          <Field label="الوظيفة" value={form.custodianJob} onChange={(v) => setForm({ ...form, custodianJob: v })} />
          <Field
            label="الرقم الوطني"
            value={form.nationalId}
            onChange={(v) => setForm({ ...form, nationalId: v })}
            hint="يُخزَّن مشفَّرًا (AES-256-GCM) ولا يظهر إلا بصلاحية كشف مسجَّلة."
          />
          <Field label="الكمية *" type="number" value={form.quantity} onChange={(v) => setForm({ ...form, quantity: v })} required />
          <Field label="ملاحظات" value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} />
          <Button type="submit" className="w-full">
            تسجيل العهدة
          </Button>
        </form>
      </Card>
    </section>
  );
}

/* -------------------------------- التعميمات -------------------------------- */

export function NoticesPanel({ session }: { session: SessionUser }) {
  const notices = useAsync(() => window.whsham.notices.list(100));
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [form, setForm] = useState({ title: '', body: '', kind: 'circular' });

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await window.whsham.notices.create(form);
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.message });
      return;
    }
    setNotice({ kind: 'ok', text: 'تم نشر التعميم.' });
    setForm({ title: '', body: '', kind: 'circular' });
    notices.reload();
  };

  return (
    <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
        {notices.error && <Alert kind="err">{notices.error}</Alert>}
        {(notices.data ?? []).length === 0 && <Card className="p-6 text-center text-muted">لا توجد تعميمات.</Card>}
        {(notices.data ?? []).map((row: NoticeRow) => (
          <Card key={row.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-bold">{row.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{row.body}</p>
                <div className="mt-3 text-xs text-muted">
                  {row.authorName ?? '—'} · <span dir="ltr">{new Date(row.createdAt).toLocaleString('ar-SY')}</span>
                </div>
              </div>
              <Badge kind={row.kind === 'alert' ? 'danger' : 'muted'}>{row.kind === 'alert' ? 'تنبيه' : 'تعميم'}</Badge>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <SectionTitle title="نشر تعميم" hint={`الكاتب: ${session.fullName}`} />
        <form className="space-y-3" onSubmit={create}>
          <Field label="العنوان *" value={form.title} onChange={(v) => setForm({ ...form, title: v })} required />
          <label className="block">
            <span className="label">النص *</span>
            <textarea
              className="field min-h-[120px]"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              required
            />
          </label>
          <Select
            label="النوع"
            value={form.kind}
            onChange={(v) => setForm({ ...form, kind: v })}
            options={[
              { value: 'circular', label: 'تعميم' },
              { value: 'alert', label: 'تنبيه' },
            ]}
          />
          <Button type="submit" className="w-full">
            نشر
          </Button>
        </form>
      </Card>
    </section>
  );
}
