import { useMemo, useState } from 'react';
import { X, Search, Shield, Fingerprint } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type OperatorIdentity = {
  id: string;
  email: string;
  role: string;
};

export type OperatorActivityEvent = {
  id: string;
  userId: string;
  email: string;
  role: string;
  occurredAt: string;
  ip?: string | null;
  userAgent?: string | null;
  method: string;
  path: string;
  route: string;
  status: number;
  latencyMs: number;
};

function fmt(dt?: string | null) {
  if (!dt) return '-';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return String(dt);
  return d.toLocaleString();
}

function statusColor(status: number) {
  if (status >= 200 && status <= 299) return 'text-emerald-300';
  if (status >= 300 && status <= 399) return 'text-sky-300';
  if (status >= 400 && status <= 499) return 'text-amber-300';
  return 'text-red-300';
}

export function OperatorActivityModal(props: {
  isOpen: boolean;
  onClose: () => void;
  operator: OperatorIdentity | null;
  events: OperatorActivityEvent[];
  loading: boolean;
  error?: string | null;
}) {
  const { isOpen, onClose, operator, events, loading, error } = props;
  const [q, setQ] = useState('');

  const role = (operator?.role || '').toLowerCase();
  const RoleIcon = role === 'admin' ? Shield : Fingerprint;

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return events;
    return events.filter((e) =>
      (e.method || '').toLowerCase().includes(s) ||
      (e.path || '').toLowerCase().includes(s) ||
      (e.route || '').toLowerCase().includes(s) ||
      String(e.status || '').includes(s) ||
      (e.ip || '').toLowerCase().includes(s)
    );
  }, [events, q]);

  const stats = useMemo(() => {
    let ok = 0;
    let warn = 0;
    let err = 0;
    for (const e of filtered) {
      if (e.status >= 200 && e.status < 400) ok += 1;
      else if (e.status >= 400 && e.status < 500) warn += 1;
      else if (e.status >= 500) err += 1;
    }
    return { total: filtered.length, ok, warn, err };
  }, [filtered]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 backdrop-blur-sm p-3 md:p-6"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <Card className="h-full border border-border bg-background/95 rounded-xl p-4 shadow-[0_22px_45px_rgba(15,23,42,0.55)] flex flex-col min-h-0">
          <div className="sticky top-0 z-10 bg-background/95 pb-3 border-b border-border/70">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2">
                <RoleIcon className="h-4 w-4 text-[var(--accent-color)]" />
                <div className="text-sm font-semibold text-foreground">Operator Activity</div>
                {operator && (
                  <div className="text-xs text-muted-foreground">
                    {operator.email} <span className="font-mono">({operator.id})</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 w-full md:w-[420px]">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    className="w-full bg-transparent outline-none text-sm"
                    placeholder="Filter by route, path, method, status, ip..."
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClose}
                  className="text-foreground hover:bg-muted"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <div className="px-2.5 py-1 rounded border border-border/70 bg-muted/20">Events: {stats.total}</div>
              <div className="px-2.5 py-1 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200">2xx/3xx: {stats.ok}</div>
              <div className="px-2.5 py-1 rounded border border-amber-500/40 bg-amber-500/10 text-amber-200">4xx: {stats.warn}</div>
              <div className="px-2.5 py-1 rounded border border-red-500/40 bg-red-500/10 text-red-200">5xx: {stats.err}</div>
            </div>
          </div>

          <div className="mt-3 text-xs text-muted-foreground shrink-0">
            This is server-side audit logging of routes accessed (no request bodies stored).
          </div>

          {error && <div className="mt-3 text-sm text-red-400 shrink-0">{error}</div>}

          <div className="mt-4 overflow-auto rounded-lg border border-border min-h-0 flex-1">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 sticky top-0 z-10">
                <tr className="text-left">
                  <th className="p-3">Time</th>
                  <th className="p-3">Method</th>
                  <th className="p-3">Route</th>
                  <th className="p-3">Path</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Latency</th>
                  <th className="p-3">IP</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="p-3 font-mono">{fmt(e.occurredAt)}</td>
                    <td className="p-3 font-mono">{e.method}</td>
                    <td className="p-3 font-mono">{e.route || '-'}</td>
                    <td className="p-3 font-mono">{e.path || '-'}</td>
                    <td className={`p-3 font-mono ${statusColor(e.status)}`}>{e.status}</td>
                    <td className="p-3 font-mono">{Number.isFinite(e.latencyMs) ? `${e.latencyMs}ms` : '-'}</td>
                    <td className="p-3 font-mono">{e.ip || '-'}</td>
                  </tr>
                ))}

                {!loading && filtered.length === 0 && (
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={7}>
                      No activity events recorded yet.
                    </td>
                  </tr>
                )}

                {loading && (
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={7}>
                      Loading activity...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
