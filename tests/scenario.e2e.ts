import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb, initDatabase } from '../src/main/db/database';
import { changePassword, login, logout } from '../src/main/services/auth';
import { createMaterial, listMaterials, saveSupplier, saveWarehouse, listWarehouses } from '../src/main/services/catalog';
import { adjust, issue, listStock, receive, transfer } from '../src/main/services/inventory';
import { assignCustody, listCustody, returnCustody, revealNationalId } from '../src/main/services/custody';
import { runReport } from '../src/main/services/reports';
import { createBackup, listBackups } from '../src/main/services/backup';
import { verifyAuditChain } from '../src/main/services/audit';
import { getSession } from '../src/main/services/auth';
import { hasPermission } from '../src/shared/permissions';
import { setSettings, getAllSettings } from '../src/main/services/settings';
import { createNotice, listNotices } from '../src/main/services/notices';

const ok = (label: string, extra = '') => console.log(`✔ ${label}${extra ? ' — ' + extra : ''}`);

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'whsham-e2e-'));
  console.log(`مجلد السيناريو: ${dir}`);

  // 1) التهيئة الأولى
  const { dbPath, initialAdminPassword } = initDatabase(dir);
  assert.ok(initialAdminPassword, 'يجب توليد كلمة مرور أولية للمدير');
  ok('تهيئة قاعدة البيانات', dbPath.split(/[\\/]/).pop() ?? '');
  const db = getDb();

  // 2) الدخول وإلزام تغيير كلمة المرور
  const admin = login(db, 'admin', initialAdminPassword!);
  assert.equal(admin.role, 'Admin');
  assert.equal(admin.mustChangePassword, true, 'يجب إلزام تغيير كلمة المرور الأولية');
  const newPassword = 'Damascus#2026!Admin';
  changePassword(db, admin.id, initialAdminPassword!, newPassword);
  logout();
  assert.throws(() => login(db, 'admin', initialAdminPassword!), /INVALID_CREDENTIALS|ACCOUNT/);
  const admin2 = login(db, 'admin', newPassword);
  assert.equal(getSession()?.id, admin2.id);
  ok('مصادقة + تغيير كلمة المرور الإلزامي + رفض الكلمة القديمة');

  // 3) الكتالوج والمستودعات والمورّدون
  const material1 = createMaterial(db, admin2, { code: 'M-100', name: 'شاش طبي 10سم', unit: 'علبة', minStock: 20, barcode: '6221001' });
  const material2 = createMaterial(db, admin2, { code: 'M-200', name: 'قفازات معقمة', unit: 'كرتون', minStock: 10, barcode: '6221002' });
  const branch = saveWarehouse(db, admin2, { name: 'مستودع فرع المزة', type: 'فرعية', location: 'دمشق - المزة' });
  saveSupplier(db, admin2, { name: 'الهلال الأحمر', sourceType: 'منحة', phone: '0110000000' });
  assert.equal((listMaterials(db).length as number), 2);
  assert.equal((listWarehouses(db).length as number), 2);
  ok('إنشاء مواد ومستودع ومورّد');

  // 4) إدخال دفعتين (الأقرب انتهاءً تُستهلك أولًا)
  receive(db, admin2, { materialId: material1.id, warehouseId: 'wh_central', quantity: 30, batchNumber: 'LOT-2028', expiryDate: '2028-05-01', entryNumber: 'IN-1' });
  receive(db, admin2, { materialId: material1.id, warehouseId: 'wh_central', quantity: 20, batchNumber: 'LOT-2026', expiryDate: '2026-11-01', entryNumber: 'IN-2' });
  receive(db, admin2, { materialId: material2.id, warehouseId: 'wh_central', quantity: 15, batchNumber: 'GLOVES-1' });
  ok('إدخال 65 وحدة على دفعات');

  // 5) إخراج FIFO
  const out1 = issue(db, admin2, { materialId: material1.id, warehouseId: 'wh_central', quantity: 25, recipient: 'قسم الإسعاف' });
  assert.equal(out1.balance, 25);
  const batches = db
    .prepare("SELECT batch_number AS b, quantity AS q FROM batches WHERE material_id = ? ORDER BY b")
    .all(material1.id) as Array<{ b: string; q: number }>;
  const map = Object.fromEntries(batches.map((row) => [row.b, row.q]));
  assert.equal(map['LOT-2026'], 0, 'الدفعة الأقرب انتهاءً تُستهلك أولًا');
  assert.equal(map['LOT-2028'], 25, 'الباقي من الدفعة الأبعد');
  ok('إخراج بنظام FIFO', 'الرصيد 25');

  // 6) نقل بين مستودعين
  transfer(db, admin2, { materialId: material2.id, fromWarehouseId: 'wh_central', toWarehouseId: branch.id, quantity: 5 });
  const branchBatches = db
    .prepare('SELECT quantity AS q FROM batches WHERE warehouse_id = ?')
    .all(branch.id) as Array<{ q: number }>;
  assert.equal(branchBatches.reduce((sum, row) => sum + row.q, 0), 5);
  ok('نقل 5 وحدات إلى الفرع');

  // 7) العهد الشخصية + تشفير الرقم الوطني
  const custody = await assignCustody(db, admin2, {
    materialId: material2.id,
    warehouseId: 'wh_central',
    custodianName: 'أحمد محمد',
    custodianJob: 'أمين مستودع',
    nationalId: '01234567890',
    quantity: 4,
  });
  const stored = db
    .prepare('SELECT custodian_nid_enc AS enc FROM personal_custody WHERE id = ?')
    .get(custody.id) as { enc: string };
  assert.ok(stored.enc.startsWith('v1:'), 'الرقم الوطني يجب أن يُخزَّن مشفَّرًا');
  assert.ok(!stored.enc.includes('01234567890'), 'القيمة الخام يجب ألا تظهر في القاعدة');
  const revealed = await revealNationalId(db, admin2, custody.id);
  assert.equal(revealed.nationalId, '01234567890', 'الكشف يعيد القيمة الصحيحة');
  await returnCustody(db, admin2, { custodyId: custody.id, quantity: 4 });
  assert.equal(listCustody(db, { status: 'active' }).length, 0, 'العهدة أُغلقت بعد الإرجاع الكامل');
  ok('عهدة شخصية + تشفير/فك تشفير الرقم الوطني + إرجاع');

  // 8) تسوية جرد
  adjust(db, admin2, { materialId: material2.id, warehouseId: 'wh_central', countedQuantity: 6, reason: 'جرد فعلي' });
  const balance2 = listStock(db, { warehouseId: 'wh_central' }).find((row) => row.materialId === material2.id);
  assert.equal(balance2?.quantity, 6);
  ok('تسوية الجرد', 'الرصيد 6');

  // 9) التقارير
  const stockReport = runReport(db, { kind: 'stock_summary' });
  const movementReport = runReport(db, { kind: 'movements' });
  const expiring = runReport(db, { kind: 'expiring_soon', days: 700 });
  const audit = runReport(db, { kind: 'audit_trail', limit: 50 });
  assert.ok(stockReport.length >= 2);
  assert.ok(movementReport.length >= 5);
  assert.ok(expiring.length >= 1);
  assert.ok(audit.length >= 5);
  ok('التقارير', `أرصدة ${stockReport.length} · حركات ${movementReport.length} · قرب الانتهاء ${expiring.length}`);

  // 10) الإعدادات والتعميمات
  setSettings(db, admin2, { org_name_ar: 'مستودعات مديرية صحة دمشق المركزية', fiscal_closed_until: '2026-01-01' });
  assert.equal(getAllSettings(db)['fiscal_closed_until'], '2026-01-01');
  createNotice(db, admin2, { title: 'تعميم جرد', body: 'يبدأ الجرد السنوي الأسبوع القادم.' });
  assert.equal(listNotices(db).length, 1);
  ok('الإعدادات + التعميمات');

  // 11) النسخ الاحتياطي
  const backupDir = join(dir, 'backups');
  const backup = createBackup(db, dbPath, backupDir, admin2);
  assert.ok(existsSync(backup.file));
  assert.ok(statSync(backup.file).size > 0);
  assert.ok(listBackups(backupDir).length >= 1);
  ok('نسخة احتياطية', `${Math.round(backup.sizeBytes / 1024)} KB`);

  // 12) سلامة سجل التدقيق
  const integrity = verifyAuditChain(db);
  assert.equal(integrity.ok, true, 'سلسلة التدقيق يجب أن تكون سليمة');
  ok('سجل التدقيق', `${integrity.checked} قيدًا بسلسلة سليمة`);

  // 13) إنكار الصلاحيات
  assert.equal(hasPermission('Observer', 'STOCK_ISSUE'), false);
  assert.equal(hasPermission('Disposal', 'STOCK_DISPOSE'), true);
  assert.equal(hasPermission('Assistant', 'USERS_MANAGE'), false);
  ok('مصفوفة الصلاحيات مطبَّقة (إنكار ضمني)');

  console.log('\nالنتيجة: السيناريو الكامل ناجح على قاعدة بيانات حقيقية على القرص.');
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error('فشل السيناريو: ' + ((error as Error)?.stack ?? String(error)));
    process.exitCode = 1;
  });
