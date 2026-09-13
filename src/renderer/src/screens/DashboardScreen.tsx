import { useMemo, useState } from 'react';
import type { SessionUser } from '../global';
import { hasPermission, type Permission } from '@shared/permissions';
import {
  CatalogPanel,
  CustodyPanel,
  NoticesPanel,
  OverviewPanel,
  StockPanel,
  SuppliersPanel,
  WarehousesPanel,
} from './panels/Operations';
import { AuditPanel, BackupPanel, ReportsPanel, SettingsPanel, UsersPanel } from './panels/Administration';

type TabId =
  | 'overview'
  | 'stock'
  | 'catalog'
  | 'warehouses'
  | 'suppliers'
  | 'custody'
  | 'notices'
  | 'reports'
  | 'users'
  | 'audit'
  | 'backup'
  | 'settings';

interface TabDef {
  id: TabId;
  label: string;
  group: string;
  permission?: Permission;
  description: string;
}

const TABS: TabDef[] = [
  { id: 'overview', label: 'لوحة المعلومات', group: 'التشغيل', permission: 'STOCK_VIEW', description: 'مؤشرات فورية عن الأرصدة والحركات والعهد.' },
  { id: 'stock', label: 'المخزون والحركات', group: 'التشغيل', permission: 'STOCK_VIEW', description: 'إدخال وإخراج ونقل وإتلاف وتسوية الجرد، ومسح الباركود.' },
  { id: 'custody', label: 'العهد الشخصية', group: 'التشغيل', permission: 'CUSTODY_VIEW', description: 'تسجيل العهد وإرجاعها مع حماية الرقم الوطني.' },
  { id: 'catalog', label: 'كتالوج المواد', group: 'البيانات', permission: 'MATERIALS_VIEW', description: 'المواد وأكوادها ووحداتها وحدود المخزون.' },
  { id: 'warehouses', label: 'المستودعات', group: 'البيانات', permission: 'WAREHOUSES_VIEW', description: 'هيكل المستودعات وأنواعها ومواقعها.' },
  { id: 'suppliers', label: 'المورّدون', group: 'البيانات', permission: 'SUPPLIERS_VIEW', description: 'سجل المورّدين وجهات الاتصال.' },
  { id: 'notices', label: 'التعميمات', group: 'التواصل', permission: 'MESSAGES_USE', description: 'تعميمات وتنبيهات داخلية.' },
  { id: 'reports', label: 'التقارير', group: 'المتابعة', permission: 'REPORTS_VIEW', description: 'تقارير الأرصدة والحركات والصلاحية والعهد مع تصدير CSV.' },
  { id: 'audit', label: 'سجل التدقيق', group: 'المتابعة', permission: 'AUDIT_VIEW', description: 'كل عملية مسجَّلة بسلسلة بصمات قابلة للتحقق.' },
  { id: 'users', label: 'المستخدمون والصلاحيات', group: 'الإدارة', permission: 'USERS_VIEW', description: 'إدارة الحسابات والأدوار ومصفوفة الصلاحيات.' },
  { id: 'backup', label: 'النسخ الاحتياطي', group: 'الإدارة', permission: 'BACKUP_MANAGE', description: 'إنشاء نسخ والاستعادة منها بأمان.' },
  { id: 'settings', label: 'الإعدادات', group: 'الإدارة', permission: 'SETTINGS_MANAGE', description: 'بيانات الجهة والإغلاق المالي.' },
];

export default function DashboardScreen({
  session,
  onLogout,
}: {
  session: SessionUser;
  onLogout: () => void;
}): React.ReactElement {
  const visibleTabs = useMemo(
    () => TABS.filter((tab) => !tab.permission || hasPermission(session.role, tab.permission)),
    [session.role],
  );
  const [tab, setTab] = useState<TabId>(visibleTabs[0]?.id ?? 'overview');
  const active = visibleTabs.find((item) => item.id === tab) ?? visibleTabs[0];

  const groups = useMemo(() => {
    const map = new Map<string, TabDef[]>();
    for (const item of visibleTabs) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()];
  }, [visibleTabs]);

  return (
    <div className="flex h-full">
      <aside className="flex w-72 flex-col border-l border-line bg-surface">
        <div className="border-b border-line p-5">
          <div className="text-lg font-bold text-brand-500">WHSHAM</div>
          <div className="mt-1 text-xs leading-relaxed text-muted">
            مستودعات مديرية صحة دمشق المركزية
            <br />
            نسخة سطح مكتب — محلية بالكامل
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-auto p-4">
          {groups.map(([group, items]) => (
            <div key={group}>
              <div className="mb-1.5 px-2 text-[11px] font-bold uppercase tracking-wide text-muted">{group}</div>
              <div className="space-y-1">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setTab(item.id)}
                    aria-current={tab === item.id ? 'page' : undefined}
                    className={`w-full rounded-xl px-3 py-2.5 text-right text-sm font-semibold transition ${
                      tab === item.id ? 'bg-brand-500 text-white' : 'text-ink hover:bg-canvas'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-4 text-xs">
          <div className="font-semibold text-ink">{session.fullName}</div>
          <div className="text-muted">{session.role}</div>
          <button className="btn-ghost mt-3 w-full" onClick={onLogout}>
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-7">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">{active?.label ?? 'لوحة المعلومات'}</h1>
          <p className="mt-1 text-sm text-muted">{active?.description}</p>
        </header>

        {tab === 'overview' && <OverviewPanel />}
        {tab === 'stock' && <StockPanel session={session} />}
        {tab === 'custody' && <CustodyPanel />}
        {tab === 'catalog' && <CatalogPanel />}
        {tab === 'warehouses' && <WarehousesPanel />}
        {tab === 'suppliers' && <SuppliersPanel />}
        {tab === 'notices' && <NoticesPanel session={session} />}
        {tab === 'reports' && <ReportsPanel />}
        {tab === 'audit' && <AuditPanel />}
        {tab === 'users' && <UsersPanel />}
        {tab === 'backup' && <BackupPanel />}
        {tab === 'settings' && <SettingsPanel session={session} />}
      </main>
    </div>
  );
}
