import { Card } from '@/components/ui/card';
import { Empty, EmptyTitle } from '@/components/ui/empty';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';

interface PieChartWidgetProps {
  data: Array<{ name: string; value: number }>;
  colors?: string[];
  height?: number;
  title?: string;
  titleColor?: string;
}

const DEFAULT_COLORS = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#14b8a6'];

export function PieChartWidget({
  data,
  colors = DEFAULT_COLORS,
  height = 250,
  title,
  titleColor: _titleColor = '#10b981',
}: PieChartWidgetProps) {
  return (
    <Card className="bg-zinc-900/30 border border-white/5 p-4">
      {title && (
        <h2 className="text-lg font-semibold mb-4 text-zinc-100">
          {title}
        </h2>
      )}
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }: { name?: string; percent?: number }) =>
                `${name || ''} ${((percent || 0) * 100).toFixed(0)}%`
              }
              outerRadius={80}
              fill="#6366f1"
              dataKey="value"
            >
              {data.map((_, index) => (
                <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: '#18181b',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: '#e4e4e7',
              }}
              labelStyle={{ color: '#a1a1aa' }}
              itemStyle={{ color: '#e4e4e7' }}
            />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <Empty className="min-h-0" style={{ height: `${height}px` }}>
          <EmptyTitle>No data</EmptyTitle>
        </Empty>
      )}
    </Card>
  );
}
