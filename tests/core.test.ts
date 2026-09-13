import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../src/main/db/schema';
import { appendAudit, verifyAuditChain } from '../src/main/services/audit';
import { adjust, issue, receive, transfer } from '../src/main/services/inventory';
import { hasPermission, ROLE_PERMISSIONS } from '../src/shared/permissions';
import type { SessionUser } from '../src/main/services/auth';

const USER: SessionUser = {
  id: 'usr_admin',
  username: 'admin',
  fullName: 'مدير النظام',
  role: 'Admin',
  mustChangePassword: false,
  warehouseIds: [],
};

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);

  db.prepare("INSERT INTO roles (id, title_ar) VALUES ('Admin', 'مدير النظام')").run();
  db.prepare(
    `INSERT INTO users (id, username, full_name, role_id, password_hash, password_salt, password_algo,
                        status, must_change_password, created_at, updated_at)
     VALUES ('usr_admin','admin','مدير النظام','Admin','h','s','scrypt','active',0,'2026-01-01','2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO warehouses (id, name, type, status, created_at, updated_at)
     VALUES ('wh_central','المستودع المركزي','مركزية','active','2026-01-01','2026-01-01'),
            ('wh_branch','مستودع فرع','فرعية','active','2026-01-01','2026-01-01')`,
  ).run();
  db.prepare(
    `INSERT INTO materials (id, code, name, unit, min_stock, status, created_at, updated_at)
     VALUES ('mat_1','M-001','شاش طبي','علبة',5,'active','2026-01-01','2026-01-01')`,
  ).run();
  return db;
}

test('الإدخال يزيد الرصيد وينشئ دفعة وحركة', () => {
  const db = freshDb();
  const result = receive(db, USER, {
    materialId: 'mat_1',
    warehouseId: 'wh_central',
    quantity: 10,
    batchNumber: 'B1',
    expiryDate: '2027-01-01',
  });

  assert.equal(result.balance, 10);
  const movements = db.prepare('SELECT COUNT(*) AS c FROM movements').get() as { c: number };
  assert.equal(movements.c, 1);
  const batches = db.prepare('SELECT COUNT(*) AS c FROM batches').get() as { c: number };
  assert.equal(batches.c, 1);
  db.close();
});

test('الإخراج يستهلك الأقرب انتهاءً أولًا (FIFO)', () => {
  const db = freshDb();
  receive(db, USER, { materialId: 'mat_1', warehouseId: 'wh_central', quantity: 5, batchNumber: 'LATE', expiryDate: '2028-01-01' });
  receive(db, USER, { materialId: 'mat_1', warehouseId: 'wh_central', quantity: 5, batchNumber: 'SOON', expiryDate: '2026-06-01' });

  const result = issue(db, USER, { materialId: 'mat_1', warehouseId: 'wh_central', quantity: 6 });
  assert.equal(result.balance, 4);

  const remaining = db
    .prepare('SELECT batch_number AS batchNumber, quantity FROM batches ORDER BY batch_number')
    .all() as Array<{ batchNumber: string; quantity: number }>;

  const byBatch = Object.fromEntries(remaining.map((row) => [row.batchNumber, row.quantity]));
  assert.equal(byBatch['SOON'], 0, 'يجب استهلاك الدفعة الأقرب انتهاءً كاملة');
  assert.equal(byBatch['LATE'], 4, 'يُستهلك 1 من الدفعة الأبعد انتهاءً');
  db.close();
});

test('رفض الإخراج عند نقص الرصيد دون أي أثر جزئي', () => {
  const db = freshDb();
  receive(db, USER, { materialId: 'mat_1', warehouseId: 'wh_central', quantity: 3 });

  assert.throws(
    () => issue(db, USER, { materialId: 'mat_1', warehouseId: 'wh_central', quantity: 5 }),
    (error: Error & { code?: string }) => error.code === 'INSUFFICIENT_STOCK',
  );

  const stock = db.prepare('SELECT quantity FROM stock_items').get() as { quantity: number };
  assert.equal(stock.quantity, 3, 'يجب أن يبقى الرصيد كما هو بعد العملية المرفوضة');
  const movements = db.prepare('SELECT COUNT(*) AS c FROM movements').get() as { c: number };
  assert.equal(movements.c, 1, 'لا تُسجَّل حركة للعملية المرفوضة');
  db.close();
});

test('النقل بين مستودعين ينقل الدفعات بخصائصها', () => {
  const db = freshDb();
  receive(db, USER, { materialId: 'mat_1', warehouseId: 'wh_central', quantity: 7, batchNumber: 'B9', expiryDate: '2027-03-01' });

  const result = transfer(db, USER, {
    materialId: 'mat_1',
    fromWarehouseId: 'wh_central',
    toWarehouseId: 'wh_branch',
    quantity: 4,
  });

  assert.equal(result.balance, 3);
  const branchBatch = db
    .prepare("SELECT quantity, batch_number AS batchNumber, expiry_date AS expiryDate FROM batches WHERE warehouse_id = 'wh_branch'")
    .get() as { quantity: number; batchNumber: string; expiryDate: string };
  assert.equal(branchBatch.quantity, 4);
  assert.equal(branchBatch.batchNumber, 'B9');
  assert.equal(branchBatch.expiryDate, '2027-03-01');
  db.close();
});

test('التسوية بلا فرق تُرفض، والتسوية بفرق تعمل', () => {
  const db = freshDb();
  receive(db, USER, { materialId: 'mat_1', warehouseId: 'wh_central', quantity: 8 });

  assert.throws(
    () => adjust(db, USER, { materialId: 'mat_1', warehouseId: 'wh_central', countedQuantity: 8, reason: 'جرد' }),
    (error: Error & { code?: string }) => error.code === 'NO_ADJUSTMENT_NEEDED',
  );

  const result = adjust(db, USER, { materialId: 'mat_1', warehouseId: 'wh_central', countedQuantity: 5, reason: 'جرد فعلي' });
  assert.equal(result.balance, 5);
  db.close();
});

test('سلسلة التدقيق سليمة، وأي تعديل مباشر يكسرها', () => {
  const db = freshDb();
  receive(db, USER, { materialId: 'mat_1', warehouseId: 'wh_central', quantity: 2 });
  issue(db, USER, { materialId: 'mat_1', warehouseId: 'wh_central', quantity: 1 });

  let integrity = verifyAuditChain(db);
  assert.equal(integrity.ok, true);
  assert.ok(integrity.checked >= 2);

  db.prepare("UPDATE audit_log SET action = 'TAMPERED' WHERE seq = 2").run();
  integrity = verifyAuditChain(db);
  assert.equal(integrity.ok, false, 'يجب كشف التعديل على السجل');
  db.close();
});

test('حذف قيود التدقيق ممنوع على مستوى القاعدة', () => {
  const db = freshDb();
  appendAudit(db, { userId: null, userName: null, action: 'X', entity: 'test' });
  assert.throws(() => db.prepare('DELETE FROM audit_log').run());
  db.close();
});

test('مصفوفة الصلاحيات: الإنكار ضمني والمدير يملك كل شيء', () => {
  assert.equal(hasPermission('Admin', 'BACKUP_MANAGE'), true);
  assert.equal(hasPermission('Observer', 'STOCK_RECEIVE'), false);
  assert.equal(hasPermission('Observer', 'STOCK_VIEW'), true);
  assert.equal(hasPermission('UnknownRole', 'STOCK_VIEW'), false, 'الدور غير المعروف لا يملك أي صلاحية');
  assert.deepEqual(ROLE_PERMISSIONS.Admin, ['*']);
});
