import { Card } from '@/components/ui/card';
import { Empty, EmptyTitle } from '@/components/ui/empty';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface TrendChartProps {
  data: any[];
  dataKeys: Array<{ key: string; color: string; gradientId: string }>;
  height?: number;
  title?: string;
  xAxisKey?: string;
}

export function TrendChart({
  data,
  dataKeys,
  height = 200,
  title,
  xAxisKey = 'hour',
}: TrendChartProps) {
  return (
    <Card className="bg-zinc-900/30 backdrop-blur-sm p-4 border border-white/5">
      {title && (
        <h2 className="text-sm font-semibold mb-3 text-zinc-100 ">
          {title}
        </h2>
      )}
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data}>
            <defs>
              {dataKeys.map(({ gradientId, color }) => (
                <linearGradient key={gradientId} id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey={xAxisKey}
              tick={{ fontSize: 10, fill: '#a1a1aa' }}
              interval={2}
              stroke="rgba(255,255,255,0.1)"
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#a1a1aa' }}
              stroke="rgba(255,255,255,0.1)"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#18181b',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: '#e4e4e7',
              }}
            />
            {dataKeys.map(({ key, color, gradientId }) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stroke={color}
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#${gradientId})`}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <Empty className="min-h-0" style={{ height: `${height}px` }}>
          <EmptyTitle>No data</EmptyTitle>
        </Empty>
      )}
    </Card>
  );
}
