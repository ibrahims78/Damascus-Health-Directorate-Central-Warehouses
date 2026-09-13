export type SessionUser = {
  id: string;
  username: string;
  fullName: string;
  role: string;
  mustChangePassword: boolean;
  warehouseIds: string[];
};

export type Envelope<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export type MaterialRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  classification: string | null;
  type: string | null;
  minStock: number;
  maxStock: number;
  barcode: string | null;
  status: string;
  totalQuantity: number;
};

export type WarehouseRow = {
  id: string;
  name: string;
  type: string;
  category: string | null;
  location: string | null;
  managerId: string | null;
  capacity: number;
  parentId: string | null;
  status: string;
  totalQuantity: number;
};

export type SupplierRow = {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  address: string | null;
  sourceType: string | null;
  status: string;
};

export type StockRow = {
  materialId: string;
  code: string;
  materialName: string;
  unit: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  minStock: number;
};

export type CustodyRow = {
  id: string;
  materialId: string;
  materialName: string;
  warehouseName: string;
  custodianName: string;
  custodianJob: string | null;
  quantity: number;
  quantityReturned: number;
  status: string;
  createdAt: string;
  hasNationalId: number;
};

export type UserRow = {
  id: string;
  username: string;
  fullName: string;
  role: string;
  status: string;
  jobTitle: string | null;
  phone: string | null;
  mustChangePassword: number;
  createdAt: string;
  warehouseIds: string | null;
};

export type RoleRow = { id: string; titleAr: string; permissions: string[] };

export type NoticeRow = {
  id: string;
  title: string;
  body: string;
  kind: string;
  authorName: string | null;
  createdAt: string;
};

export type AuditRow = {
  seq: number;
  action: string;
  entity: string;
  entityId: string | null;
  userName: string | null;
  createdAt: string;
};

export type BackupRow = { file: string; sizeBytes: number; createdAt: string };

export type DashboardStats = {
  materials: number;
  warehouses: number;
  totalQuantity: number;
  belowMin: number;
  movementsToday: number;
  openCustody: number;
  expiringSoon: number;
};

export type AppSettings = Record<string, string>;

export interface WhshamApi {
  auth: {
    login(username: string, password: string): Promise<Envelope<SessionUser>>;
    logout(): Promise<Envelope<{ ok: boolean }>>;
    me(): Promise<Envelope<SessionUser | null>>;
    changePassword(oldPassword: string, newPassword: string): Promise<Envelope<{ ok: boolean }>>;
  };
  materials: {
    list(query?: string | null, onlyBelowMin?: boolean): Promise<Envelope<MaterialRow[]>>;
    create(input: Record<string, unknown>): Promise<Envelope<{ id: string }>>;
    update(input: Record<string, unknown>): Promise<Envelope<{ ok: true }>>;
  };
  warehouses: {
    list(): Promise<Envelope<WarehouseRow[]>>;
    save(input: Record<string, unknown>): Promise<Envelope<{ id: string }>>;
  };
  suppliers: {
    list(): Promise<Envelope<SupplierRow[]>>;
    save(input: Record<string, unknown>): Promise<Envelope<{ id: string }>>;
  };
  inventory: {
    stock(filters?: {
      warehouseId?: string | null;
      query?: string | null;
      onlyBelowMin?: boolean;
    }): Promise<Envelope<StockRow[]>>;
    receive(input: Record<string, unknown>): Promise<Envelope<{ movementId: string; balance: number }>>;
    issue(input: Record<string, unknown>): Promise<Envelope<{ movementId: string; balance: number }>>;
    transfer(input: Record<string, unknown>): Promise<Envelope<{ movementId: string; balance: number }>>;
    dispose(input: Record<string, unknown>): Promise<Envelope<{ movementId: string; balance: number }>>;
    adjust(input: Record<string, unknown>): Promise<Envelope<{ movementId: string; balance: number }>>;
    findByBarcode(code: string): Promise<
      Envelope<{ id: string; name: string; unit: string; code: string } | null>
    >;
  };
  custody: {
    list(status?: 'active' | 'closed' | null): Promise<Envelope<CustodyRow[]>>;
    assign(input: Record<string, unknown>): Promise<Envelope<{ id: string; balance: number }>>;
    returnBack(input: Record<string, unknown>): Promise<Envelope<{ ok: true; balance: number }>>;
    revealId(custodyId: string): Promise<Envelope<{ nationalId: string | null }>>;
  };
  reports: {
    run(input: Record<string, unknown>): Promise<Envelope<Array<Record<string, unknown>>>>;
    export(input: Record<string, unknown>): Promise<Envelope<{ file: string; rows: number }>>;
  };
  users: {
    list(): Promise<Envelope<UserRow[]>>;
    create(input: Record<string, unknown>): Promise<Envelope<{ id: string; temporaryPassword: string }>>;
    setStatus(input: Record<string, unknown>): Promise<Envelope<{ ok: true }>>;
    setRole(input: Record<string, unknown>): Promise<Envelope<{ ok: true }>>;
    resetPassword(userId: string): Promise<Envelope<{ temporaryPassword: string }>>;
    roles(): Promise<Envelope<RoleRow[]>>;
  };
  notices: {
    list(limit?: number): Promise<Envelope<NoticeRow[]>>;
    create(input: Record<string, unknown>): Promise<Envelope<{ id: string }>>;
    remove(id: string): Promise<Envelope<{ ok: true }>>;
  };
  audit: {
    list(limit?: number): Promise<Envelope<AuditRow[]>>;
    verify(): Promise<Envelope<{ ok: boolean; checked: number; brokenAtSeq: number | null }>>;
  };
  settings: {
    get(): Promise<Envelope<AppSettings>>;
    set(patch: Record<string, string>): Promise<Envelope<AppSettings>>;
  };
  backup: {
    list(): Promise<Envelope<BackupRow[]>>;
    create(): Promise<Envelope<BackupRow>>;
    restore(file: string): Promise<Envelope<{ ok: true; safetyCopy: string }>>;
    export(file: string): Promise<Envelope<{ file: string }>>;
  };
  dashboard: {
    stats(): Promise<Envelope<DashboardStats>>;
  };
}

declare global {
  interface Window {
    whsham: WhshamApi;
  }
}
