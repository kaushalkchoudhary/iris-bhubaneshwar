import { UserX, Activity, Clock, Shield, Camera, UserPlus, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { timeAgo } from './FRSShared';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface UnknownSubjectsTabProps {
    unknownFaces: any[];
    unknownTotal: number;
    loadingUnknown: boolean;
    onConvertClick: (face: any) => void;
}

export function UnknownSubjectsTab({
    unknownFaces,
    unknownTotal,
    loadingUnknown,
    onConvertClick
}: UnknownSubjectsTabProps) {
    const [selectedFace, setSelectedFace] = useState<any | null>(null);

    return (
        <div className="h-full flex flex-col lg:flex-row gap-3 overflow-hidden p-1">
            {/* ── Left: list ──────────────────────────── */}
            <div className="w-full lg:w-[260px] xl:w-[300px] shrink-0 flex flex-col bg-zinc-900/30 border border-border/40 backdrop-blur-sm rounded-xl overflow-hidden">
                {/* Header */}
                <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <UserX className="h-3.5 w-3.5 text-amber-600 dark:text-amber-500/70" />
                            <p className="text-[11px] font-mono tracking-widest text-muted-foreground uppercase">Unknown Faces</p>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                            <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                            <p className="text-[10px] font-mono text-foreground/70">{unknownTotal} pending review</p>
                        </div>
                    </div>
                    <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                </div>

                {/* List */}
                <div className="flex-1 overflow-y-auto iris-scroll-area">
                    {loadingUnknown && unknownFaces.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                            <Loader2 className="h-6 w-6 text-zinc-700 animate-spin" />
                            <p className="text-[10px] font-mono text-zinc-700 tracking-widest">Loading</p>
                        </div>
                    ) : unknownFaces.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3">
                            <Activity className="h-8 w-8 text-zinc-800 opacity-40" />
                            <p className="text-[10px] font-mono text-zinc-600 tracking-wider">No unknown faces</p>
                        </div>
                    ) : unknownFaces.map((face, idx) => {
                        const isActive = selectedFace?.id === face.id;
                        return (
                            <button
                                key={face.id || idx}
                                type="button"
                                onClick={() => setSelectedFace(face)}
                                className={cn(
                                    'w-full text-left flex gap-3 items-center px-5 py-3 border-b border-white/[0.04] transition-colors group',
                                    isActive ? 'bg-amber-500/[0.07]' : 'hover:bg-white/[0.02]'
                                )}
                            >
                                <div className={cn('w-10 h-10 shrink-0 overflow-hidden bg-black/50', isActive && 'ring-1 ring-amber-500/40')}>
                                    <img
                                        src={face.faceSnapshotUrl || face.metadata?.images?.['face.jpg'] || face.fullSnapshotUrl}
                                        className="w-full h-full object-cover"
                                        alt=""
                                    />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={cn('text-[11px] font-semibold uppercase tracking-tight', isActive ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground group-hover:text-foreground')}>
                                        Unknown Face
                                    </p>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <Camera className="h-3 w-3 text-muted-foreground shrink-0" />
                                        <span className="text-[10px] font-mono text-muted-foreground truncate uppercase">
                                            {face.deviceId || face.cameraId || 'Unknown'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                                        <p className="text-[10px] font-mono text-muted-foreground">{timeAgo(face.timestamp)}</p>
                                    </div>
                                </div>
                                <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', isActive ? 'bg-amber-500 dark:bg-amber-400' : 'bg-muted-foreground/30 group-hover:bg-muted-foreground/50')} />
                            </button>
                        );
                    })}
                </div>

                {/* Footer count */}
                <div className="shrink-0 px-5 py-2.5 border-t border-white/5">
                    <p className="text-[9px] font-mono text-zinc-700 tracking-[0.15em] uppercase">{unknownFaces.length} shown · Manual review</p>
                </div>
            </div>

            {/* ── Right: detail ───────────────────────── */}
            <div className="flex-1 min-w-0 flex flex-col bg-zinc-900/30 border border-border/40 backdrop-blur-sm rounded-xl overflow-hidden">
                {selectedFace ? (
                    <>
                        {/* Header */}
                        <div className="shrink-0 px-6 py-3 border-b border-white/5 flex items-center justify-between">
                            <div>
                                <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                                    <span className="text-sm font-mono font-bold text-amber-600 dark:text-amber-300 uppercase tracking-wide">Unknown Subject</span>
                                </div>
                                <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
                                    <span className="uppercase">{selectedFace.deviceId || selectedFace.cameraId || 'Unknown camera'}</span>
                                    &nbsp;·&nbsp;{new Date(selectedFace.timestamp).toLocaleString()}
                                </p>
                            </div>
                            <Button
                                className="h-8 px-4 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 border border-amber-500/20 hover:border-amber-500/30 font-mono text-[11px] tracking-wider transition-all flex items-center gap-2 rounded-lg"
                                onClick={() => onConvertClick(selectedFace)}
                            >
                                <UserPlus className="h-3.5 w-3.5" />
                                Create Profile
                                <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                        </div>

                        {/* Full frame — takes all available space */}
                        <div className="flex-1 min-h-0 bg-black/50 flex items-center justify-center overflow-hidden">
                            <img
                                src={selectedFace.fullSnapshotUrl || selectedFace.metadata?.images?.['frame.jpg'] || selectedFace.faceSnapshotUrl}
                                className="max-h-full max-w-full object-contain"
                                alt=""
                            />
                        </div>

                        {/* Metadata row — translucent dashboard style */}
                        <div className="shrink-0 border-t border-white/5 grid grid-cols-4 bg-black/20 backdrop-blur-md">
                            {[
                                { label: 'Detection ID', value: `#${String(selectedFace.id || '—').slice(0, 8)}`, cls: 'text-foreground' },
                                { label: 'Camera', value: (selectedFace.deviceId || selectedFace.cameraId || 'Unknown').toUpperCase(), cls: 'text-foreground' },
                                { label: 'Detected', value: timeAgo(selectedFace.timestamp), cls: 'text-foreground' },
                                { label: 'Status', value: 'Unidentified', cls: 'text-amber-600 dark:text-amber-400' },
                            ].map((s, i) => (
                                <div key={s.label} className={cn('px-6 py-4 hover:bg-white/[0.02] transition-colors', i < 3 && 'border-r border-white/5')}>
                                    <span className="text-[10px] font-mono tracking-widest text-muted-foreground uppercase block mb-1">{s.label}</span>
                                    <p className={cn('text-lg font-mono font-bold tracking-tight', s.cls)}>{s.value}</p>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3">
                        <UserX className="h-10 w-10 text-zinc-800" />
                        <p className="text-xs font-mono text-zinc-600 tracking-wider">Select a face to inspect</p>
                    </div>
                )}
            </div>
        </div>
    );
}
