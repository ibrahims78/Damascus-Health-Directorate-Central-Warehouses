import { contextBridge, ipcRenderer } from 'electron';

/**
 * الجسر الوحيد بين الواجهة والعملية الرئيسية.
 * واجهة مُعدَّدة بأسماء صريحة — لا تمرير قنوات عام ولا كشف لأي قدرة نظامية.
 */

type Envelope<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

function invoke<T>(channel: string, payload: unknown = {}): Promise<Envelope<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<Envelope<T>>;
}

const api = {
  auth: {
    login: (username: string, password: string) => invoke('auth:login', { username, password }),
    logout: () => invoke('auth:logout'),
    me: () => invoke('auth:me'),
    changePassword: (oldPassword: string, newPassword: string) =>
      invoke('auth:changePassword', { oldPassword, newPassword }),
  },
  materials: {
    list: (query?: string) => invoke('materials:list', { query: query ?? null }),
    create: (input: {
      code: string;
      name: string;
      unit: string;
      category?: string | null;
      type?: string | null;
      minStock?: number;
      barcode?: string | null;
    }) => invoke('materials:create', input),
  },
  warehouses: {
    list: () => invoke('warehouses:list'),
  },
  inventory: {
    stock: (filters?: { warehouseId?: string | null; query?: string | null }) =>
      invoke('inventory:stock', {
        warehouseId: filters?.warehouseId ?? null,
        query: filters?.query ?? null,
      }),
    receive: (input: unknown) => invoke('inventory:receive', input),
    issue: (input: unknown) => invoke('inventory:issue', input),
  },
  audit: {
    list: (limit = 100) => invoke('audit:list', { limit }),
    verify: () => invoke('audit:verify'),
  },
  dashboard: {
    stats: () => invoke('dashboard:stats'),
  },
} as const;

export type WhshamApi = typeof api;

contextBridge.exposeInMainWorld('whsham', api);
