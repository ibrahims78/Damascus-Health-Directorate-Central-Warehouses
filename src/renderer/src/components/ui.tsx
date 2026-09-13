import { useCallback, useEffect, useState, type ReactNode } from 'react';

/** عناصر واجهة موحّدة — كل الشاشات تستخدمها لضمان الاتساق. */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const styles =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'danger'
        ? 'btn bg-danger-500 text-white hover:bg-danger-700 disabled:opacity-50'
        : 'btn-ghost';
  return (
    <button type={type} className={`${styles} ${className}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
  hint,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <input
        className="field"
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Alert({ kind, children }: { kind: 'ok' | 'err' | 'warn'; children: ReactNode }) {
  const styles =
    kind === 'ok'
      ? 'bg-success-50 text-success-700'
      : kind === 'warn'
        ? 'bg-warn-50 text-warn-700'
        : 'bg-danger-50 text-danger-700';
  return (
    <div role="status" className={`mb-4 rounded-xl px-4 py-3 text-sm font-semibold ${styles}`}>
      {children}
    </div>
  );
}

export function Empty({ text, colSpan }: { text: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 text-center text-muted">
        {text}
      </td>
    </tr>
  );
}

export function Loading({ text = 'جارٍ التحميل…' }: { text?: string }) {
  return <div className="py-8 text-center text-muted">{text}</div>;
}

export function DataTable({
  headers,
  children,
  dense,
}: {
  headers: string[];
  children: ReactNode;
  dense?: boolean;
}) {
  return (
    <div className="card overflow-hidden">
      <table className={`table ${dense ? 'text-xs' : ''}`}>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone = 'brand',
}: {
  label: string;
  value: string | number;
  tone?: 'brand' | 'danger' | 'warn' | 'ok';
}) {
  const color =
    tone === 'danger'
      ? 'text-danger-500'
      : tone === 'warn'
        ? 'text-warn-500'
        : tone === 'ok'
          ? 'text-success-500'
          : 'text-brand-500';
  return (
    <div className="card p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

export function Badge({ kind, children }: { kind: 'ok' | 'warn' | 'danger' | 'muted'; children: ReactNode }) {
  const styles =
    kind === 'ok'
      ? 'bg-success-50 text-success-700'
      : kind === 'warn'
        ? 'bg-warn-50 text-warn-700'
        : kind === 'danger'
          ? 'bg-danger-50 text-danger-700'
          : 'bg-canvas text-muted';
  return <span className={`badge ${styles}`}>{children}</span>;
}

/** جالب بيانات بسيط مع إعادة تحميل — يوحّد حالات التحميل والخطأ. */
export function useAsync<T>(
  loader: () => Promise<{ ok: true; data: T } | { ok: false; code: string; message: string }>,
  deps: unknown[] = [],
): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (value: T) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    let active = true;
    setLoading(true);
    void loader()
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          setData(result.data);
          setError(null);
        } else {
          setError(result.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => reload(), [reload]);

  return { data, error, loading, reload, setData };
}
