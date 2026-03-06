import { Monitor, ScanFace, X, Cpu, Wifi, Maximize2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MatchThumbnail, type CrowdAlert } from './FRSShared';
import type { Person } from '@/lib/api';
import { DirectWebRTCFrame } from '@/components/cameras/DirectWebRTCFrame';
import { cn } from '@/lib/utils';

interface LiveMonitorTabProps {
    liveMatches: CrowdAlert[];
    persons: Person[];
    jetsons: Array<{
        workerId: string;
        name: string;
        ip?: string;
        reachable: boolean;
        cameraCount: number;
        resources?: { cpu_load_1m?: number; memory_percent?: number; temperature_c?: number };
    }>;
    camerasByWorker: Record<string, Array<{ id: string; name: string }>>;
    onOpenMatchDetail: (match: CrowdAlert) => void;
    onClearMatches: () => void;
    onAddToGallery: (match: CrowdAlert, person: Person) => void;
    onSwitchTab: (tab: string) => void;
}

export function LiveMonitorTab({
    liveMatches,
    persons,
    jetsons,
    camerasByWorker,
    onOpenMatchDetail,
    onClearMatches,
    onAddToGallery,
    onSwitchTab
}: LiveMonitorTabProps) {
    const [zoomed, setZoomed] = useState<{ ip?: string; id: string; name: string; streamPath?: string } | null>(null);

    return (
        <div className="h-full m-0 flex flex-col lg:flex-row gap-4 overflow-hidden">
            <div className="w-full lg:w-72 xl:w-80 flex flex-col shrink-0 bg-zinc-900/20 border border-white/5 backdrop-blur-sm overflow-hidden max-h-[320px] lg:max-h-none relative rounded-xl">
                <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ScanFace className="w-3.5 h-3.5 text-indigo-400" />
                        <span className="text-[11px] font-mono font-bold text-zinc-400 uppercase tracking-[0.2em]">Live Matches</span>
                    </div>
                    <button
                        className="text-zinc-500 hover:text-white transition-colors"
                        onClick={onClearMatches}
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2 iris-scroll-area">
                    {liveMatches.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center h-full min-h-[120px] text-zinc-700 opacity-40">
                            <div className="p-4 border border-dashed border-zinc-800 mb-3">
                                <ScanFace className="h-10 w-10" />
                            </div>
                            <p className="text-[10px] font-mono tracking-widest uppercase">Waiting for detections</p>
                        </div>
                    ) : (
                        liveMatches
                            .filter((match) => match.metadata?.person_id || match.metadata?.is_known)
                            .map((match) => (
                                <MatchThumbnail
                                    key={match.id}
                                    match={match}
                                    persons={persons}
                                    onClick={() => onOpenMatchDetail(match)}
                                    onAddToGallery={onAddToGallery}
                                />
                            ))
                    )}
                </div>
            </div>

            <div className="flex-1 flex flex-col min-w-0 min-h-0">
                {persons.length === 0 && (
                    <div className="shrink-0 mb-4 flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-amber-500/5 text-amber-600 dark:text-amber-400/80">
                        <div className="flex items-center gap-3">
                            <div className="p-1.5 rounded-lg bg-amber-500/10">
                                <Wifi className="h-4 w-4 shrink-0" />
                            </div>
                            <p className="text-[10px] leading-relaxed font-medium">
                                Watchlist is empty. Add a person to start flagged matches.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[9px] border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 font-bold uppercase"
                            onClick={() => onSwitchTab('watchlist')}
                        >
                            Add person
                        </Button>
                    </div>
                )}

                {jetsons.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-zinc-700 rounded-xl bg-zinc-900/20 border border-white/5 my-0">
                        <div className="relative">
                            <Wifi className="h-8 w-8 mb-4 opacity-10" />
                        </div>
                        <p className="text-[9px] font-mono tracking-[0.3em] uppercase opacity-40">No live streams detected</p>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto pr-1 iris-scroll-area">
                        <div className="space-y-8 pb-4">
                            {jetsons.map(jetson => {
                                const cameras = (camerasByWorker[jetson.workerId] ?? []).map((c) => ({ ...c, streamPath: undefined as string | undefined }));
                                return (
                                    <div key={jetson.workerId} className="group/worker">
                                        <div className="flex items-center gap-3 mb-4 px-1">
                                            <div className={cn(
                                                "p-1.5 border transition-colors rounded-lg",
                                                jetson.reachable ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400" : "bg-red-500/10 border-red-500/20 text-red-400"
                                            )}>
                                                <Cpu className="h-3.5 w-3.5" />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-[0.25em]">{jetson.name}</span>
                                            </div>
                                        </div>

                                        {/* Resource info removed for vertical space */}
                                        {
                                            cameras.length === 0 ? (
                                                <div className="rounded-lg border border-dashed border-white/10 bg-zinc-900/30 py-10 text-center">
                                                    <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">No cameras assigned</p>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                                                    {cameras.map(cam => (
                                                        <div key={cam.id} className="relative aspect-video rounded-xl overflow-hidden group/cam transition-all border border-white/5 hover:border-indigo-500/30 bg-black/20">
                                                            <DirectWebRTCFrame
                                                                workerIp={jetson.ip}
                                                                cameraId={cam.id}
                                                                streamPath={cam.streamPath}
                                                                className="w-full h-full object-cover transition-transform duration-700 group-hover/cam:scale-105"
                                                            />

                                                            <div className="absolute inset-x-0 bottom-0 top-0 pointer-events-none p-3 flex flex-col justify-between opacity-0 group-hover/cam:opacity-100 transition-opacity">
                                                                <div className="flex justify-between">
                                                                    <div className="w-4 h-4 border-t border-l border-indigo-400/50" />
                                                                    <div className="w-4 h-4 border-t border-r border-indigo-400/50" />
                                                                </div>
                                                                <div className="flex justify-between">
                                                                    <div className="w-4 h-4 border-b border-l border-indigo-400/50" />
                                                                    <div className="w-4 h-4 border-b border-r border-indigo-400/50" />
                                                                </div>
                                                            </div>

                                                            <div className="absolute top-2.5 left-2.5 pointer-events-none">
                                                                <div className="bg-zinc-950/80 backdrop-blur-md px-2 py-0.5 text-[8px] font-bold text-red-500 flex items-center gap-1.5 border border-red-500/20 rounded-md">
                                                                    <div className="w-1 h-1 bg-red-500 animate-pulse rounded-full" /> LIVE
                                                                </div>
                                                            </div>

                                                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent px-3 pb-2.5 pt-8 pointer-events-none">
                                                                <div className="flex items-end justify-between">
                                                                    <div>
                                                                        <p className="text-zinc-100 text-[10px] font-mono font-bold uppercase tracking-tight truncate">{cam.name}</p>
                                                                    </div>
                                                                    <Monitor className="h-3 w-3 text-indigo-400/40" />
                                                                </div>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={() => setZoomed({ ip: jetson.ip, id: cam.id, name: cam.name, streamPath: cam.streamPath })}
                                                                className="absolute top-2.5 right-2.5 z-10 h-6 w-6 rounded border border-white/15 bg-black/55 text-indigo-300 hover:bg-black/70 flex items-center justify-center"
                                                                title="Expand feed"
                                                            >
                                                                <Maximize2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )
                                        }
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {zoomed && (
                <div
                    className="fixed inset-0 z-[90] bg-black/85 backdrop-blur-sm p-4 md:p-8"
                    onClick={() => setZoomed(null)}
                >
                    <div className="relative w-full h-full max-w-[1600px] mx-auto rounded-xl overflow-hidden border border-white/10 bg-black">
                        <div className="absolute top-3 left-3 z-10 pointer-events-none">
                            <div className="bg-black/65 rounded px-2 py-0.5">
                                <p className="text-xs text-white font-medium truncate max-w-[70vw]">{zoomed.name}</p>
                            </div>
                        </div>
                        <DirectWebRTCFrame
                            workerIp={zoomed.ip}
                            cameraId={zoomed.id}
                            streamPath={zoomed.streamPath}
                            className="w-full h-full"
                        />
                    </div>
                </div>
            )}
        </div >
    );
}
