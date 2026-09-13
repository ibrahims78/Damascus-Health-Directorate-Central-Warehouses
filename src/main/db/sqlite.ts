import { DatabaseSync } from 'node:sqlite';

/**
 * طبقة قاعدة بيانات محلية مبنية على `node:sqlite` المدمج في Node/Electron.
 * لا وحدة أصلية ولا بناء تجميعي ولا تنزيل رؤوس — التطبيق يعمل دون اتصال بالكامل.
 *
 * تُقدّم نفس الواجهة المستخدمة في بقية الخدمات: prepare/exec/pragma/transaction/close.
 */

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface Statement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): RunResult;
}

export class Database {
  private readonly raw: DatabaseSync;
  private depth = 0;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    // قيود المفاتيح الأجنبية مُفعَّلة افتراضيًا في node:sqlite، وتُؤكَّد هنا صراحةً.
    this.raw.exec('PRAGMA foreign_keys = ON');
  }

  prepare(sql: string): Statement {
    const statement = this.raw.prepare(sql);
    return {
      get: (...params: unknown[]) => statement.get(...(params as never[])),
      all: (...params: unknown[]) => statement.all(...(params as never[])) as unknown[],
      run: (...params: unknown[]) => {
        const result = statement.run(...(params as never[]));
        return {
          changes: Number(result.changes ?? 0),
          lastInsertRowid: Number(result.lastInsertRowid ?? 0),
        };
      },
    };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** تعيد صفوف نتيجة PRAGMA (مثل integrity_check). */
  pragma(query: string): unknown[] {
    return this.raw.prepare(`PRAGMA ${query}`).all() as unknown[];
  }

  /** تنفيذ مجموعة عمليات داخل معاملة واحدة؛ تُلغى كاملةً عند أي خطأ. */
  transaction<T>(fn: () => T): () => T {
    return () => {
      const nested = this.depth > 0;
      if (!nested) this.raw.exec('BEGIN IMMEDIATE');
      this.depth += 1;
      try {
        const result = fn();
        this.depth -= 1;
        if (!nested) this.raw.exec('COMMIT');
        return result;
      } catch (error) {
        this.depth -= 1;
        if (!nested) {
          try {
            this.raw.exec('ROLLBACK');
          } catch {
            /* المعاملة أُلغيت مسبقًا */
          }
        }
        throw error;
      }
    };
  }

  close(): void {
    this.raw.close();
  }
}
