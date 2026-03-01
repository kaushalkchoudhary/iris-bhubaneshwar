import { Card } from '@/components/ui/card';
import { Empty, EmptyTitle } from '@/components/ui/empty';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { DeviceHeartbeatPoint } from '@/lib/api';

const ROLLING_24H_MINUTES = 24 * 60; // 1440

function minuteKey(d: Date): string {
  const t = new Date(d);
  t.setSeconds(0, 0);
  t.setMilliseconds(0);
  return t.toISOString();
}

/**
 * Uptime % over rolling 24h: (minutes with >=1 heartbeat) / 1440 * 100.
 * Minutes with no event count as downtime. Returns null if no heartbeats.
 */
export function computeUptimePercent(heartbeats: DeviceHeartbeatPoint[]): number | null {
  if (heartbeats.length === 0) return null;
  const upSet = new Set<string>();
  for (const h of heartbeats) {
    upSet.add(minuteKey(new Date(h.timestamp)));
  }
  return (upSet.size / ROLLING_24H_MINUTES) * 100;
}

/**
 * One point per minute for the last 24h. upPercent = 100 if that minute has >=1 heartbeat, else 0.
 * Minutes with no event show as downtime (0).
 */
function aggregateByMinute(heartbeats: DeviceHeartbeatPoint[]): { bucket: string; upPercent: number }[] {
  const upSet = new Set<string>();
  for (const h of heartbeats) {
    upSet.add(minuteKey(new Date(h.timestamp)));
  }
  const now = new Date();
  const start = new Date(now.getTime() - ROLLING_24H_MINUTES * 60 * 1000);
  start.setSeconds(0, 0);
  start.setMilliseconds(0);
  const data: { bucket: string; upPercent: number }[] = [];
  for (let i = 0; i < ROLLING_24H_MINUTES; i++) {
    const m = new Date(start.getTime() + i * 60 * 1000);
    const key = minuteKey(m);
    data.push({ bucket: key, upPercent: upSet.has(key) ? 100 : 0 });
  }
  return data;
}

interface UptimeChartProps {
  heartbeats: DeviceHeartbeatPoint[];
  height?: number;
  title?: string;
}

export function UptimeChart({ heartbeats, height = 200, title = 'Uptime' }: UptimeChartProps) {
  const data = aggregateByMinute(heartbeats);

  return (
    <Card className="bg-zinc-900/30 border border-white/5 backdrop-blur-sm p-4">
      <h2 className="text-sm font-semibold mb-3 text-zinc-100 ">{title}</h2>
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="uptimeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" opacity={0.5} />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 10, fill: '#71717a', fontFamily: 'monospace' }}
              interval={Math.max(0, Math.floor(data.length / 24) - 1)}
              tickFormatter={(v) =>
                new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
              }
              stroke="#3f3f46"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: '#71717a', fontFamily: 'monospace' }}
              stroke="#3f3f46"
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#18181b',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '4px',
                color: '#d4d4d8',
                fontFamily: 'monospace',
              }}
              labelFormatter={(v) => new Date(v).toLocaleString()}
              formatter={(value: any) => [`${value}%`, 'Uptime']}
            />
            <Area
              type="monotone"
              dataKey="upPercent"
              stroke="#10b981"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#uptimeGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <Empty className="min-h-0" style={{ height }}>
          <EmptyTitle>No heartbeat data</EmptyTitle>
        </Empty>
      )}
    </Card>
  );
}
