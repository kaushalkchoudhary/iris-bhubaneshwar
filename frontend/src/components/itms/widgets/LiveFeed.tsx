import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface LiveFeedProps<T> {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  autoScroll?: boolean;
  refreshInterval?: number;
  loading?: boolean;
  emptyMessage?: string;
  className?: string;
}

export function LiveFeed<T>({
  items,
  renderItem,
  autoScroll = false,
  refreshInterval: _refreshInterval,
  loading = false,
  emptyMessage = 'No data',
  className = '',
}: LiveFeedProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (autoScroll && items.length > 0) {
      const interval = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % items.length);
        if (scrollRef.current) {
          scrollRef.current.scrollTo({
            left: (currentIndex * scrollRef.current.clientWidth),
            behavior: 'smooth',
          });
        }
      }, 3000);

      return () => clearInterval(interval);
    }
  }, [autoScroll, items.length, currentIndex]);

  if (loading && items.length === 0) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className={`text-center text-zinc-500 py-8 ${className}`}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div ref={scrollRef} className={`overflow-x-auto ${className}`}>
      <div className="flex gap-4">
        {items.map((item, index) => (
          <div key={index} className="flex-shrink-0">
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
}
