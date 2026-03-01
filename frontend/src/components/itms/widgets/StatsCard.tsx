import { Card } from '@/components/ui/card';
import { formatNumber } from './utils';
import { cn } from '@/lib/utils';
import type { ComponentType } from 'react';

interface StatsCardProps {
  title: string;
  value: number | string | null | undefined;
  subtitle?: string;
  icon?: ComponentType<{ className?: string }>;
  color: 'cyan' | 'magenta' | 'yellow' | 'green';
  size?: 'normal' | 'large';
}

const colorConfig = {
  cyan: {
    border: 'border-indigo-500/30',
    text: 'text-indigo-400',
    bg: 'bg-indigo-500/5',
  },
  magenta: {
    border: 'border-rose-500/30',
    text: 'text-rose-400',
    bg: 'bg-rose-500/5',
  },
  yellow: {
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    bg: 'bg-amber-500/5',
  },
  green: {
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/5',
  },
};

export function StatsCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
  size = 'normal',
}: StatsCardProps) {
  const config = colorConfig[color];
  const valueSize = size === 'large' ? 'text-4xl' : 'text-3xl';
  const titleSize = size === 'large' ? 'text-base' : 'text-sm';
  const iconSize = size === 'large' ? 'w-6 h-6' : 'w-5 h-5';

  return (
    <Card
      className={cn(
        'bg-zinc-900/30 backdrop-blur-sm p-4 transition-all border border-white/5',
        `hover:${config.border}`
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={cn(titleSize, 'text-zinc-400 font-medium')}>{title}</div>
        {Icon && (
          <Icon className={cn(iconSize, config.text)} />
        )}
      </div>
      <div className={cn(valueSize, 'font-semibold', config.text)}>
        {typeof value === 'number' ? formatNumber(value) : value || '0'}
      </div>
      {subtitle && (
        <div className="text-xs text-zinc-500 mt-1">
          {subtitle}
        </div>
      )}
    </Card>
  );
}
