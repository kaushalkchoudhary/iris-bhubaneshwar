import { Activity, UserX, Clock, MapPin, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { FRSGlobalIdentity } from '@/lib/api';

interface JourneyTimelineTabProps {
    globalIdentities: FRSGlobalIdentity[];
    selectedGlobalIdentity: FRSGlobalIdentity | null;
    loadingIdentities: boolean;
    globalTimeline: any[];
    loadingGlobalTimeline: boolean;
    onSelectIdentity: (identity: FRSGlobalIdentity) => void;
}

export function JourneyTimelineTab({
    globalIdentities,
    selectedGlobalIdentity,
    loadingIdentities,
    globalTimeline,
    loadingGlobalTimeline,
    onSelectIdentity
}: JourneyTimelineTabProps) {
    return (
        <div className="h-full m-0 flex flex-col lg:flex-row gap-5 overflow-hidden">
            {/* Sidebar - Identity Clusters */}
            <Card className="w-full lg:w-80 xl:w-96 shrink-0 flex flex-col bg-zinc-900/30 border border-border/40 backdrop-blur-sm overflow-hidden relative">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />

                <div className="px-5 py-4 border-b border-white/5 bg-white/[0.02]">
                    <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-widest flex items-center gap-2">
                        <Activity className="h-4 w-4 text-blue-500" /> Identity Matrix
                    </h3>
                    <p className="text-[9px] text-zinc-500 font-mono mt-1 uppercase">RE-IDENTIFICATION CLUSTERS</p>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-2 iris-scroll-area">
                    {loadingIdentities && globalIdentities.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-zinc-700">
                            <Loader2 className="h-8 w-8 animate-spin opacity-20 mb-4" />
                            <p className="text-[10px] font-mono uppercase tracking-widest">Scanning network clusters...</p>
                        </div>
                    ) : globalIdentities.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 text-zinc-700 opacity-40">
                            <UserX className="h-10 w-10 mb-4" />
                            <p className="text-[10px] font-mono uppercase tracking-widest">No Clusters Found</p>
                        </div>
                    ) : (
                        globalIdentities.map((gid) => {
                            const name = gid.associatedPerson?.name || `CLUSTER_${gid.globalIdentityId.slice(0, 8)}`;
                            const isSelected = selectedGlobalIdentity?.globalIdentityId === gid.globalIdentityId;
                            const isKnown = !!gid.associatedPersonId;

                            return (
                                <div
                                    key={gid.globalIdentityId}
                                    className={cn(
                                        "p-3 rounded-xl cursor-pointer transition-all border group relative overflow-hidden",
                                        isSelected
                                            ? "border-blue-500/40 bg-blue-500/5 shadow-[0_0_15px_rgba(59,130,246,0.1)]"
                                            : "border-transparent hover:bg-white/[0.03] hover:border-white/5"
                                    )}
                                    onClick={() => onSelectIdentity(gid)}
                                >
                                    <div className="flex gap-4 items-center relative z-10">
                                        <div className="w-12 h-12 rounded-lg overflow-hidden border border-white/10 shrink-0 bg-black group-hover:border-blue-500/40 transition-colors">
                                            {isKnown ? (
                                                <img src={gid.associatedPerson?.faceImageUrl} className="w-full h-full object-cover" alt="" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center opacity-20">
                                                    <UserX className="h-6 w-6" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={cn("text-[11px] font-bold uppercase truncate tracking-tight transition-colors", isSelected ? "text-blue-400" : "text-zinc-100 group-hover:text-blue-400")}>
                                                {name}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-[9px] font-mono text-zinc-500 truncate uppercase mt-0.5">{gid.globalIdentityId.slice(0, 12)}...</span>
                                                <Badge className={cn("h-3.5 px-1.5 text-[7px] border-0 font-bold uppercase", isKnown ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400")}>
                                                    {isKnown ? 'KNOWN' : 'UNKNOWN'}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                    {isSelected && (
                                        <div className="absolute top-0 right-0 p-1">
                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </Card>

            {/* Main Analysis Display */}
            <div className="flex-1 min-w-0 flex flex-col gap-5 overflow-hidden">
                <div className="px-1 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-zinc-100 uppercase tracking-widest">
                            <Clock className="h-3.5 w-3.5 text-blue-500" /> RE-IDENTIFICATION PATH
                        </div>
                    </div>
                    {selectedGlobalIdentity && (
                        <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 font-mono text-[9px]">ENCRYPTED_TRACE_NODE_{selectedGlobalIdentity.globalIdentityId.slice(0, 8)}</Badge>
                    )}
                </div>

                <Card className="flex-1 relative rounded-3xl bg-zinc-900/30 border border-border/40 backdrop-blur-sm overflow-hidden iris-scroll-area p-8">
                    {loadingGlobalTimeline ? (
                        <div className="h-full flex flex-col items-center justify-center gap-4 text-zinc-600">
                            <Loader2 className="h-10 w-10 animate-spin opacity-20" />
                            <p className="text-[10px] font-mono tracking-widest uppercase">Tracing biometric signatures...</p>
                        </div>
                    ) : !selectedGlobalIdentity ? (
                        <div className="h-full flex flex-col items-center justify-center text-zinc-700 opacity-40 gap-6">
                            <div className="p-8 rounded-full border border-white/5 relative">
                                <Activity className="h-12 w-12" />
                                <div className="absolute inset-0 border border-blue-500/10 rounded-full animate-ping" />
                            </div>
                            <div className="text-center space-y-2">
                                <p className="text-xs font-bold uppercase tracking-[0.3em]">Neural Link Ready</p>
                                <p className="text-[9px] font-mono uppercase">Select a cluster to visualize movement path</p>
                            </div>
                        </div>
                    ) : globalTimeline.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-zinc-700 opacity-40">
                            <p className="text-[10px] font-mono uppercase tracking-widest text-center">No segments found for this signature trace</p>
                        </div>
                    ) : (
                        <div className="relative pl-12 space-y-12">
                            {/* Vertical Timeline Line */}
                            <div className="absolute left-[23px] top-4 bottom-4 w-px bg-gradient-to-b from-blue-500/60 via-blue-500/20 to-transparent" />

                            {globalTimeline.map((det, idx) => (
                                <div key={det.id} className="relative group/segment">
                                    {/* Segment Indicator */}
                                    <div className={cn(
                                        "absolute -left-[30px] top-2 h-4 w-4 rounded-full border-2 border-zinc-950 z-20 transition-all",
                                        idx === 0 ? "bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)] scale-110" : "bg-zinc-800 border-zinc-700 group-hover/segment:bg-blue-400"
                                    )} />

                                    <div className="flex flex-col lg:flex-row gap-6 p-5 rounded-2xl bg-zinc-900/30 border border-white/5 hover:border-blue-500/30 transition-all group/card">
                                        <div className="w-full lg:w-64 xl:w-72 aspect-video rounded-xl overflow-hidden border border-white/10 bg-black shrink-0 relative">
                                            <img
                                                src={det.faceSnapshotUrl || det.metadata?.images?.['face.jpg'] || det.fullSnapshotUrl || det.metadata?.images?.['frame.jpg']}
                                                className="w-full h-full object-cover opacity-80 group-hover/segment:scale-105 transition-transform duration-700"
                                                alt=""
                                            />
                                            <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[8px] font-black text-blue-400 border border-white/10 uppercase tracking-widest">
                                                NODE_SEGMENT_{String(idx + 1).padStart(2, '0')}
                                            </div>
                                        </div>

                                        <div className="flex-1 min-w-0 space-y-4">
                                            <div className="flex items-start justify-between">
                                                <div>
                                                    <h4 className="font-black text-sm text-zinc-100 uppercase tracking-tight flex items-center gap-2">
                                                        <MapPin className="h-4 w-4 text-blue-500" /> {det.device?.name || det.deviceId || "STATION_UKNW"}
                                                    </h4>
                                                    <div className="flex items-center gap-3 mt-1.5 font-mono text-[10px] text-zinc-500 uppercase">
                                                        <span>{new Date(det.timestamp).toLocaleDateString()}</span>
                                                        <div className="w-1 h-1 rounded-full bg-zinc-800" />
                                                        <span className="text-zinc-400">{new Date(det.timestamp).toLocaleTimeString()}</span>
                                                    </div>
                                                </div>
                                                <div className="px-3 py-1.5 rounded-lg bg-blue-500/5 border border-blue-500/10 text-[10px] font-mono font-bold text-blue-400">
                                                    SIGNATURE_STRENGTH: {Math.round((det.confidence || 0.85) * 100)}%
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                                                {[
                                                    { label: 'DEVICE_ID', value: det.deviceId?.slice(0, 12) || 'UKNW' },
                                                    { label: 'DETECTION_QUALITY', value: `${Math.round((det.metadata?.quality_score || 0.8) * 100)}%` },
                                                    { label: 'VECTOR_HASH', value: det.id?.slice(-8).toUpperCase() || 'N/A' },
                                                    { label: 'GEO_COORDS', value: '48.8566, 2.3522' }
                                                ].map((trait, i) => (
                                                    <div key={i} className="bg-black/20 p-2 rounded-lg border border-white/5">
                                                        <p className="text-[7px] text-zinc-600 font-bold uppercase tracking-widest">{trait.label}</p>
                                                        <p className="text-[10px] text-zinc-300 font-mono mt-0.5 truncate uppercase">{trait.value}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}
