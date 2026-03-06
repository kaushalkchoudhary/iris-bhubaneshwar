import { Monitor, Eye, Plus } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { Person } from '@/lib/api';

export interface CrowdAlert {
    id: number;
    deviceId: string;
    alertType: string;
    title: string;
    description: string;
    timestamp: string;
    severity: string;
    metadata: any;
    isResolved: boolean;
    device?: { name: string };
    name: string;
}

export const normalizeAlertTitle = (value: unknown) => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'name' in value) return String(value.name);
    return 'Unknown Subject';
};

export const timeAgo = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
};

export const ThreatBadge = ({ level }: { level?: string }) => {
    const l = level?.toLowerCase();
    const variant = l === 'high' ? 'threatHigh' : l === 'medium' ? 'threatMedium' : 'threatLow';
    return (
        <Badge variant={variant as any}>
            {level?.toUpperCase() || 'MEDIUM'}
        </Badge>
    );
};

export const CategoryBadge = ({ category }: { category?: string }) => (
    <Badge variant="category" className="bg-zinc-800 text-zinc-400 border-zinc-700">
        {category === 'Warrant' ? 'WANTED' : category?.toUpperCase() || 'N/A'}
    </Badge>
);

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export const resolveBoxRect = (rawBox: any, frameSize?: { width: number; height: number }) => {
    if (!Array.isArray(rawBox) || rawBox.length < 4) return null;
    const [a, b, c, d] = rawBox.map((value: unknown) => Number(value));
    if (![a, b, c, d].every(Number.isFinite)) return null;

    const x1 = a;
    const y1 = b;
    const x2 = c > a ? c : a + Math.max(c, 0);
    const y2 = d > b ? d : b + Math.max(d, 0);
    const width = Math.max(0, x2 - x1);
    const height = Math.max(0, y2 - y1);

    const isNormalized = [x1, y1, x2, y2].every((value) => value >= 0 && value <= 1.5);
    if (isNormalized) {
        return {
            left: clampPercent(x1 * 100),
            top: clampPercent(y1 * 100),
            width: clampPercent(width * 100),
            height: clampPercent(height * 100),
        };
    }

    if (frameSize && frameSize.width > 0 && frameSize.height > 0) {
        return {
            left: clampPercent((x1 / frameSize.width) * 100),
            top: clampPercent((y1 / frameSize.height) * 100),
            width: clampPercent((width / frameSize.width) * 100),
            height: clampPercent((height / frameSize.height) * 100),
        };
    }

    return null;
};

export const DetectionFrame = ({
    frameSrc,
    faceSrc,
    box,
    showBoundingBox = true,
    className,
    imgClassName,
}: {
    frameSrc?: string;
    faceSrc?: string;
    box?: any;
    showBoundingBox?: boolean;
    className?: string;
    imgClassName?: string;
}) => {
    const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
    const rect = showBoundingBox ? resolveBoxRect(box, frameSize) : null;
    const showInset = !!(faceSrc && frameSrc && faceSrc !== frameSrc);

    return (
        <div className={cn("relative overflow-hidden rounded-sm bg-black/20 backdrop-blur-md shadow-none group", className)}>
            {frameSrc ? (
                <img
                    src={frameSrc}
                    className={cn("w-full h-full object-cover transition-transform duration-500 group-hover:scale-105", imgClassName)}
                    onLoad={(event) => {
                        const image = event.currentTarget;
                        setFrameSize({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
                    }}
                    alt=""
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-700">
                    <Monitor className="h-6 w-6" />
                </div>
            )}

            <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
            </div>

            {rect && (
                <div
                    className="absolute border border-indigo-300/70 shadow-[0_0_0_1px_rgba(165,180,252,0.18)]"
                    style={{
                        left: `${rect.left}%`,
                        top: `${rect.top}%`,
                        width: `${rect.width}%`,
                        height: `${rect.height}%`,
                    }}
                >
                    <div className="absolute inset-x-0 top-0 h-px bg-indigo-300/70" />
                </div>
            )}

            {showInset && (
                <div className="absolute top-2 right-12 h-14 w-14 overflow-hidden rounded-md border border-white/10 bg-black/90 p-0.5">
                    <img src={faceSrc} className="h-full w-full object-cover" alt="" />
                </div>
            )}
        </div>
    );
};

export const PersonCard = ({ person, idx, onClick, compact }: { person: Person; idx: number; onClick: () => void; compact?: boolean }) => (
    <div
        onClick={onClick}
        className={cn(
            "group relative overflow-hidden bg-zinc-900/40 hover:bg-zinc-800/60 transition-colors p-2.5 flex items-start gap-3 rounded-xl border border-white/5",
            person.threatLevel === 'High'
                ? "hover:bg-red-500/10 border-red-500/20"
                : "hover:border-indigo-500/30"
        )}
    >
        <div className={cn(
            "rounded-md bg-black shrink-0 overflow-hidden transition-colors relative",
            compact ? "h-12 w-12" : "h-14 w-14"
        )}>
            <img src={person.faceImageUrl} className="w-full h-full object-cover" alt="" />
            {person.threatLevel === 'High' && (
                <div className="absolute inset-0 bg-red-500/10 animate-pulse" />
            )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center">
            <div className="flex items-center justify-between gap-2">
                <p className="font-bold text-xs text-zinc-100 truncate group-hover:text-indigo-200 transition-colors uppercase tracking-tight">{person.name}</p>
                <span className="text-[9px] font-mono text-zinc-500 shrink-0">#{String(idx + 1).padStart(3, '0')}</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <ThreatBadge level={person.threatLevel} />
                <CategoryBadge category={person.category} />
            </div>
            {!compact && person.aliases && (
                <p className="text-[9px] text-zinc-500 mt-1 truncate font-mono">ID: {person.id.slice(0, 8)}</p>
            )}
        </div>
    </div>
);

export const MatchThumbnail = ({
    match,
    persons,
    onClick,
    onAddToGallery
}: {
    match: CrowdAlert;
    persons: Person[];
    onClick: () => void;
    onAddToGallery?: (match: CrowdAlert, person: Person) => void;
}) => {
    const personId = match.metadata?.person_id;
    const matchedPerson = personId ? persons.find(p => String(p.id) === String(personId)) : null;
    const displayName = matchedPerson?.name || match.metadata?.person_name || match.title;
    const matchScore = match.metadata?.match_score || 0;
    const qualityScore = match.metadata?.quality_score || 0;

    const showAddButton = matchedPerson && qualityScore > 0.7 && matchScore > 0.35;

    return (
        <div
            className="flex gap-3 bg-zinc-900/40 hover:bg-zinc-800/60 p-2.5 cursor-pointer transition-colors relative group overflow-hidden border-b border-white/[0.04] last:border-0"
        >
            <div onClick={onClick} className="flex gap-3 flex-1 items-center">
                <div className="flex h-12 w-[80px] overflow-hidden rounded-lg shrink-0 relative border border-white/10">
                    <div className="w-1/2 h-full bg-black/40 border-r border-white/5 relative">
                        <img
                            src={matchedPerson?.faceImageUrl || match.metadata?.images?.['face.jpg']}
                            className="w-full h-full object-cover"
                            alt=""
                        />
                    </div>
                    <div className="w-1/2 h-full bg-black/40 relative">
                        <img
                            src={match.metadata?.images?.['face.jpg'] || match.metadata?.images?.['frame.jpg']}
                            className="w-full h-full object-cover"
                            alt=""
                        />
                    </div>
                </div>
                <div className="min-w-0 flex-1 flex flex-col">
                    <p className="font-bold text-[11px] truncate text-zinc-200 group-hover:text-indigo-300 transition-colors uppercase tracking-tight font-mono">{normalizeAlertTitle(displayName)}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] text-zinc-500 font-mono font-medium truncate uppercase tracking-tighter">
                            {matchedPerson?.category || match.metadata?.person_category || match.deviceId || 'Station HQ'}
                        </span>
                        {matchScore > 0 && (
                            <span className="text-[9px] font-mono text-indigo-400/80">{(matchScore * 100).toFixed(0)}% Match</span>
                        )}
                    </div>
                    <p className="text-[9px] text-zinc-600 mt-1 font-mono tracking-tighter opacity-70">{timeAgo(match.timestamp)}</p>
                </div>
                <div className="flex items-center pr-1">
                    <Eye className="h-3.5 w-3.5 text-zinc-700 group-hover:text-indigo-400/50 transition-colors" />
                </div>
            </div>

            {showAddButton && onAddToGallery && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onAddToGallery(match, matchedPerson);
                    }}
                    className="absolute top-1.5 right-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 text-[8px] px-2 py-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 backdrop-blur-sm font-mono tracking-widest"
                >
                    <Plus className="h-2.5 w-2.5" />
                    LINK
                </button>
            )}
        </div>
    );
};
