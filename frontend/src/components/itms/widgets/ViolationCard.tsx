import { Badge } from '@/components/ui/badge';
import { Camera } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getViolationTypeColor, getViolationTypeLabel, formatTimeAgo } from './utils';
import type { TrafficViolation } from '@/lib/api';

interface ViolationCardProps {
  violation: TrafficViolation;
  onClick?: () => void;
  compact?: boolean;
  showLive?: boolean;
}

export function ViolationCard({
  violation,
  onClick,
  compact = false,
  showLive = false,
}: ViolationCardProps) {
  const hasImage = violation.fullSnapshotUrl || violation.plateImageUrl;

  return (
    <div
      className={cn(
        "relative aspect-video bg-black rounded-lg overflow-hidden border border-white/10 transition-all",
        onClick && "cursor-pointer hover:border-indigo-500/50 hover:ring-1 hover:ring-indigo-500/30",
        compact && "aspect-square"
      )}
      onClick={onClick}
    >
      {hasImage ? (
        <>
          <img
            src={violation.fullSnapshotUrl || violation.plateImageUrl || ''}
            alt="Violation"
            className="w-full h-full object-cover"
          />
          {/* Top Overlay - Violation Type and LIVE */}
          <div className="absolute top-1 left-1 right-1 flex items-center justify-between pointer-events-none">
            <Badge className={cn("text-[10px] px-1.5 py-0.5", getViolationTypeColor(violation.violationType))}>
              {getViolationTypeLabel(violation.violationType)}
            </Badge>
            {showLive && (
              <span className="text-[10px] text-emerald-400 font-medium bg-zinc-900/90 px-1.5 py-0.5 rounded border border-emerald-500/30">
                LIVE
              </span>
            )}
          </div>
          {/* Bottom Overlay - Plate Number and Timestamp */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2 pointer-events-none">
            {violation.plateNumber && (
              <div className="text-xs font-bold text-zinc-100 font-mono mb-1">
                {violation.plateNumber}
              </div>
            )}
            <div className="text-[10px] text-zinc-400">
              {formatTimeAgo(violation.timestamp)}
            </div>
          </div>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-zinc-900/50">
          <Camera className="w-8 h-8 text-zinc-600" />
        </div>
      )}
    </div>
  );
}
