export type SessionUser = {
  id: string;
  username: string;
  fullName: string;
  role: string;
  mustChangePassword: boolean;
  warehouseIds: string[];
};

export type Envelope<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface WhshamApi {
  auth: {
    login(username: string, password: string): Promise<Envelope<SessionUser>>;
    logout(): Promise<Envelope<{ ok: boolean }>>;
    me(): Promise<Envelope<SessionUser | null>>;
    changePassword(oldPassword: string, newPassword: string): Promise<Envelope<{ ok: boolean }>>;
  };
  materials: {
    list(query?: string): Promise<Envelope<MaterialRow[]>>;
    create(input: {
      code: string;
      name: string;
      unit: string;
      category?: string | null;
      type?: string | null;
      minStock?: number;
      barcode?: string | null;
    }): Promise<Envelope<{ id: string }>>;
  };
  warehouses: {
    list(): Promise<Envelope<WarehouseRow[]>>;
  };
  inventory: {
    stock(filters?: {
      warehouseId?: string | null;
      query?: string | null;
    }): Promise<Envelope<StockRow[]>>;
    receive(input: Record<string, unknown>): Promise<
      Envelope<{ batchId: string; movementId: string; balance: number }>
    >;
    issue(input: Record<string, unknown>): Promise<
      Envelope<{ movementId: string; balance: number }>
    >;
  };
  audit: {
    list(limit?: number): Promise<Envelope<AuditRow[]>>;
    verify(): Promise<Envelope<{ ok: boolean; checked: number; brokenAtSeq: number | null }>>;
  };
  dashboard: {
    stats(): Promise<Envelope<DashboardStats>>;
  };
}

export type MaterialRow = {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  type: string | null;
  minStock: number;
  barcode: string | null;
  status: string;
};

export type WarehouseRow = {
  id: string;
  name: string;
  type: string;
  category: string | null;
  location: string | null;
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

export type AuditRow = {
  seq: number;
  action: string;
  entity: string;
  entityId: string | null;
  userName: string | null;
  createdAt: string;
};

export type DashboardStats = {
  materials: number;
  warehouses: number;
  totalQuantity: number;
  belowMin: number;
  movementsToday: number;
};

declare global {
  interface Window {
    whsham: WhshamApi;
  }
}
