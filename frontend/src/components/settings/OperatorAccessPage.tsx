import { useEffect, useMemo, useState } from 'react';
import { Shield, Unlock, KeyRound, RefreshCw, LogOut, Search, Eye, CheckCircle2, MoreHorizontal } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api';
import { OperatorActivityModal, type OperatorActivityEvent } from './OperatorActivityModal';

type OperatorAccount = {
  id: string;
  email: string;
  role: string;
  lastLogin?: string | null;
  lastLoginIP?: string | null;
  lastLoginUserAgent?: string | null;
  geoipCountry?: string | null;
  geoipRegion?: string | null;
  geoipCity?: string | null;
  geoipLatitude?: number | null;
  geoipLongitude?: number | null;
  geoipTimezone?: string | null;
  tokenVersion: number;
  failedLoginCount: number;
  lastFailedLoginAt?: string | null;
  lastFailedLoginIP?: string | null;
  lastFailedLoginUserAgent?: string | null;
  lockoutUntil?: string | null;
  passwordResetRequired?: boolean;
  pendingAdminApproval?: boolean;
  active: boolean;
  activeUntil?: string | null;
  createdAt: string;
  updatedAt: string;
};

type AuthEvent = {
  id: string;
  userId: string;
  email: string;
  role: string;
  eventType: string;
  occurredAt: string;
  ip?: string | null;
  userAgent?: string | null;
  geoipCountry?: string | null;
  geoipRegion?: string | null;
  geoipCity?: string | null;
  geoipLatitude?: number | null;
  geoipLongitude?: number | null;
  geoipTimezone?: string | null;
};

function fmt(dt?: string | null) {
  if (!dt) return '-';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return String(dt);
  return d.toLocaleString();
}

function locked(lockoutUntil?: string | null) {
  if (!lockoutUntil) return false;
  const d = new Date(lockoutUntil);
  return !Number.isNaN(d.getTime()) && d.getTime() > Date.now();
}

function fmtGeo(o: { geoipCity?: string | null; geoipRegion?: string | null; geoipCountry?: string | null }) {
  const parts = [o.geoipCity, o.geoipRegion, o.geoipCountry].map((s) => (s || '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : '-';
}

function geoMapHref(lat?: number | null, lng?: number | null) {
  if (lat == null || lng == null) return '';
  if (Number.isNaN(lat) || Number.isNaN(lng)) return '';
  return `https://maps.google.com/?q=${lat},${lng}`;
}

function fmtEventType(eventType: string) {
  const t = (eventType || '').toLowerCase();
  if (t === 'login_success') return { label: 'Login Success', variant: 'success' as const };
  if (t === 'login_failure') return { label: 'Login Failure', variant: 'destructive' as const };
  if (t === 'lockout') return { label: 'Lockout', variant: 'warning' as const };
  return { label: eventType || '-', variant: 'secondary' as const };
}

function fmtRelative(dt?: string | null) {
  if (!dt) return '-';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return '-';
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function OperatorAccessPage() {
  const [loading, setLoading] = useState(true);
  const [operators, setOperators] = useState<OperatorAccount[]>([]);
  const [events, setEvents] = useState<AuthEvent[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityFor, setActivityFor] = useState<OperatorAccount | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityEvents, setActivityEvents] = useState<OperatorActivityEvent[]>([]);
  const [actionMenu, setActionMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, ev] = await Promise.all([
        apiClient.getOperatorAccounts(),
        apiClient.getOperatorLoginEvents(200),
      ]);
      setOperators(data.operators || []);
      setPendingApprovals(data.pendingApprovals || 0);
      setEvents(ev.events || []);
      setActionMenu(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!actionMenu) return;

    const close = () => setActionMenu(null);
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-operator-action-menu="true"]')) return;
      if (target.closest('[data-operator-action-trigger="true"]')) return;
      close();
    };

    document.addEventListener('mousedown', onDocMouseDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [actionMenu]);

  const sorted = useMemo(() => {
    return [...operators].sort((a, b) => a.email.localeCompare(b.email));
  }, [operators]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((o) =>
      o.email.toLowerCase().includes(q) ||
      o.id.toLowerCase().includes(q) ||
      (o.lastLoginIP || '').toLowerCase().includes(q) ||
      (o.geoipCity || '').toLowerCase().includes(q) ||
      (o.geoipRegion || '').toLowerCase().includes(q) ||
      (o.geoipCountry || '').toLowerCase().includes(q)
    );
  }, [sorted, query]);

  const unlockOperator = async (id: string) => {
    if (!confirm('Unlock this operator now?')) return;
    setBusyId(id);
    try {
      await apiClient.unlockOperatorAccount(id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const resetPassword = async (id: string) => {
    if (!confirm('Reset operator password now? This will invalidate the old password.')) return;
    setBusyId(id);
    try {
      const resp = await apiClient.resetOperatorPassword(id);
      await load();
      alert(`Temporary password (share securely):\n\n${resp.password}`);
    } finally {
      setBusyId(null);
    }
  };

  const forceLogout = async (id: string) => {
    if (!confirm('Force logout this operator now? They will need to log in again.')) return;
    setBusyId(id);
    try {
      await apiClient.forceLogoutOperatorAccount(id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const approveAccess = async (id: string) => {
    if (!confirm('Approve this operator access now?')) return;
    setBusyId(id);
    try {
      await apiClient.approveOperatorAccess(id);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const openActivity = async (op: OperatorAccount) => {
    setActivityFor(op);
    setActivityOpen(true);
    setActivityLoading(true);
    setActivityError(null);
    try {
      const resp = await apiClient.getOperatorActivityEvents(op.id, 250);
      setActivityEvents((resp.events || []) as OperatorActivityEvent[]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setActivityError(msg);
      setActivityEvents([]);
    } finally {
      setActivityLoading(false);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-hidden p-6 flex flex-col gap-4">
      <OperatorActivityModal
        isOpen={activityOpen}
        onClose={() => setActivityOpen(false)}
        operator={activityFor ? { id: activityFor.id, email: activityFor.email, role: activityFor.role } : null}
        events={activityEvents}
        loading={activityLoading}
        error={activityError}
      />

      <Card className="border-border/60 bg-gradient-to-b from-card to-card/70 shrink-0 overflow-hidden">
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Shield className="h-5 w-5 text-[var(--accent-color)]" />
                Operator Access Control
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Lockout, forced session revocation, reset approval workflow, and operator activity audit.
              </p>
            </div>
            <Button variant="outline" onClick={load} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>

          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background px-3 py-2 w-full md:max-w-xl">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                className="w-full bg-transparent outline-none text-sm"
                placeholder="Search by email, id, IP, city, region, country..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {pendingApprovals > 0 && (
            <div className="text-sm border border-amber-500/40 bg-amber-500/10 text-amber-200 px-3 py-2 rounded-md">
              {pendingApprovals} operator account{pendingApprovals > 1 ? 's are' : ' is'} waiting for admin approval.
            </div>
          )}

          {error && <div className="text-sm text-red-400">{error}</div>}
        </CardHeader>

        <CardContent className="space-y-3">
          <div className="max-h-[32vh] overflow-auto rounded-lg border border-border/70" onClick={() => setActionMenu(null)}>
            <table className="w-full text-sm">
              <thead className="bg-muted/30 sticky top-0 z-20">
                <tr className="text-left">
                  <th className="p-3">Operator</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Failed</th>
                  <th className="p-3">Lockout Until</th>
                  <th className="p-3">Last Login</th>
                  <th className="p-3">IP</th>
                  <th className="p-3">Geo (Server)</th>
                  <th className="p-3">Geo TZ</th>
                  <th className="p-3">Active Until</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((op) => {
                  const isLocked = locked(op.lockoutUntil);
                  return (
                    <tr key={op.id} className="border-t border-border/60 hover:bg-muted/20">
                      <td className="p-3">
                        <div className="font-medium text-foreground">{op.email}</div>
                        <div className="text-xs text-muted-foreground">id: {op.id}</div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant={isLocked ? 'warning' : 'success'}>{isLocked ? 'LOCKED' : 'ACTIVE'}</Badge>
                          {op.pendingAdminApproval && <Badge variant="warning">PENDING APPROVAL</Badge>}
                          {op.passwordResetRequired && <Badge variant="info">RESET REQUIRED</Badge>}
                        </div>
                        {op.pendingAdminApproval && (
                          <div className="text-xs text-muted-foreground mt-1">Waiting for admin approval</div>
                        )}
                        {isLocked && (
                          <div className="text-xs text-muted-foreground mt-1">Locked by failed attempts policy</div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="font-mono">{op.failedLoginCount}</div>
                        <div className="text-xs text-muted-foreground">Last fail: {fmtRelative(op.lastFailedLoginAt)}</div>
                      </td>
                      <td className="p-3 font-mono">{op.lockoutUntil ? `${fmt(op.lockoutUntil)} (${fmtRelative(op.lockoutUntil)})` : '-'}</td>
                      <td className="p-3">
                        <div>{fmt(op.lastLogin)}</div>
                        <div className="text-xs text-muted-foreground">{fmtRelative(op.lastLogin)}</div>
                      </td>
                      <td className="p-3 font-mono">{op.lastLoginIP || '-'}</td>
                      <td className="p-3">
                        <div>{fmtGeo(op)}</div>
                        {geoMapHref(op.geoipLatitude, op.geoipLongitude) && (
                          <a
                            href={geoMapHref(op.geoipLatitude, op.geoipLongitude)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline"
                          >
                            View map
                          </a>
                        )}
                      </td>
                      <td className="p-3 font-mono">{op.geoipTimezone || '-'}</td>
                      <td className="p-3 font-mono">{op.activeUntil ? fmt(op.activeUntil) : '-'}</td>
                      <td className="p-3">
                        <div onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="outline"
                            size="sm"
                            data-operator-action-trigger="true"
                            onClick={(e) => {
                              const btn = e.currentTarget as HTMLButtonElement;
                              const rect = btn.getBoundingClientRect();
                              const menuWidth = 176;
                              const padding = 8;
                              const x = Math.min(
                                Math.max(padding, rect.right - menuWidth),
                                window.innerWidth - menuWidth - padding
                              );
                              const y = Math.min(rect.bottom + 6, window.innerHeight - 230);
                              setActionMenu((prev) => (prev?.id === op.id ? null : { id: op.id, x, y }));
                            }}
                            disabled={loading}
                          >
                            <MoreHorizontal className="h-4 w-4 mr-2" />
                            Actions
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {!loading && filtered.length === 0 && (
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={10}>
                      No operator accounts match your search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

        </CardContent>
      </Card>

      <Card className="border-border/60 bg-gradient-to-b from-card to-card/70 flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="space-y-1">
          <CardTitle className="text-sm tracking-wider">Operator Login History</CardTitle>
          <p className="text-sm text-muted-foreground">
            Recent auth events (success, failure, lockout) for operator accounts.
          </p>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-hidden">
          <div className="h-full min-h-0 overflow-auto rounded-lg border border-border/70">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="text-left">
                  <th className="p-3">Time</th>
                  <th className="p-3">Operator</th>
                  <th className="p-3">Event</th>
                  <th className="p-3">IP</th>
                  <th className="p-3">Geo (Server)</th>
                  <th className="p-3">Geo TZ</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const et = fmtEventType(e.eventType);
                  return (
                    <tr key={e.id} className="border-t border-border/60 hover:bg-muted/20">
                      <td className="p-3">
                        <div className="font-mono">{fmt(e.occurredAt)}</div>
                        <div className="text-xs text-muted-foreground">{fmtRelative(e.occurredAt)}</div>
                      </td>
                      <td className="p-3">{e.email}</td>
                      <td className="p-3"><Badge variant={et.variant}>{et.label}</Badge></td>
                      <td className="p-3 font-mono">{e.ip || '-'}</td>
                      <td className="p-3">
                        <div>{fmtGeo(e)}</div>
                        {geoMapHref(e.geoipLatitude, e.geoipLongitude) && (
                          <a
                            href={geoMapHref(e.geoipLatitude, e.geoipLongitude)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline"
                          >
                            View map
                          </a>
                        )}
                      </td>
                      <td className="p-3 font-mono">{e.geoipTimezone || '-'}</td>
                    </tr>
                  );
                })}

                {!loading && events.length === 0 && (
                  <tr>
                    <td className="p-4 text-muted-foreground" colSpan={6}>
                      No operator logins recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {actionMenu && (() => {
        const op = filtered.find((o) => o.id === actionMenu.id);
        if (!op) return null;
        const isBusy = busyId === op.id;
        return (
          <div
            data-operator-action-menu="true"
            className="fixed z-[90] w-44 rounded-md border border-border/80 bg-background/95 p-1 shadow-xl"
            style={{ left: `${actionMenu.x}px`, top: `${actionMenu.y}px` }}
          >
            <button
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted/50 flex items-center gap-2"
              onClick={async () => {
                setActionMenu(null);
                await openActivity(op);
              }}
              disabled={isBusy}
            >
              <Eye className="h-4 w-4" />
              View Activity
            </button>
            <button
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted/50 flex items-center gap-2 disabled:opacity-50"
              onClick={async () => {
                setActionMenu(null);
                await unlockOperator(op.id);
              }}
              disabled={loading || isBusy}
            >
              <Unlock className="h-4 w-4" />
              Unlock
            </button>
            <button
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted/50 flex items-center gap-2 disabled:opacity-50"
              onClick={async () => {
                setActionMenu(null);
                await resetPassword(op.id);
              }}
              disabled={loading || isBusy}
            >
              <KeyRound className="h-4 w-4" />
              Reset Password
            </button>
            <button
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted/50 flex items-center gap-2 disabled:opacity-50"
              onClick={async () => {
                setActionMenu(null);
                await approveAccess(op.id);
              }}
              disabled={loading || isBusy || !op.pendingAdminApproval}
            >
              <CheckCircle2 className="h-4 w-4" />
              Approve Access
            </button>
            <button
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted/50 flex items-center gap-2 disabled:opacity-50 text-amber-300"
              onClick={async () => {
                setActionMenu(null);
                await forceLogout(op.id);
              }}
              disabled={loading || isBusy}
            >
              <LogOut className="h-4 w-4" />
              Force Logout
            </button>
          </div>
        );
      })()}
    </div>
  );
}
