import { Upload, Loader2, Camera, ScanFace, Users2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Person } from '@/lib/api';
import { ThreatBadge, CategoryBadge } from './FRSShared';

interface SubjectSearchTabProps {
    persons: Person[];
    searchForm: any;
    searchPreview: string | null;
    searchLoading: boolean;
    searchResults: any[];
    onSearchFormChange: (updates: any) => void;
    onSearchFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onSearchSubmit: () => void;
    onPersonClick: (person: Person) => void;
}

// Shared input/select class matching analytics dashboard aesthetic
const fieldCls = 'h-8 w-full bg-zinc-950/40 border border-white/10 rounded-lg text-[11px] font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 px-3 transition-colors';
const labelCls = 'text-[9px] uppercase font-mono font-bold text-zinc-500 tracking-[0.2em] mb-1.5 block';

function FieldLabel({ children }: { children: React.ReactNode }) {
    return <label className={labelCls}>{children}</label>;
}

export function SubjectSearchTab({
    persons,
    searchForm,
    searchPreview,
    searchLoading,
    searchResults,
    onSearchFormChange,
    onSearchFileChange,
    onSearchSubmit,
    onPersonClick
}: SubjectSearchTabProps) {
    return (
        <div className="h-full flex flex-col overflow-hidden p-2 lg:p-4 relative bg-transparent">
            {/* Ambient background glow from the scanner */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 blur-[100px] rounded-full pointer-events-none" />

            {/* ── Dashboard Layout ── */}
            <div className="flex-1 flex flex-col lg:flex-row gap-4 relative z-10 w-full h-full max-w-[1800px] mx-auto">

                {/* ── Left Column: Enrollment Form ── */}
                <div className="w-full lg:w-[320px] xl:w-[350px] shrink-0 flex flex-col h-full bg-zinc-900/20 backdrop-blur-sm border border-white/5 rounded-xl">

                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
                        <div className="space-y-4">
                            <div>
                                <FieldLabel>Subject Designation *</FieldLabel>
                                <Input placeholder="Full Name / ID" className={fieldCls} value={searchForm.name} onChange={(e) => onSearchFormChange({ name: e.target.value })} />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <FieldLabel>Age</FieldLabel>
                                    <Input type="number" placeholder="Years" className={fieldCls} value={searchForm.age} onChange={(e) => onSearchFormChange({ age: e.target.value })} />
                                </div>
                                <div>
                                    <FieldLabel>Gender</FieldLabel>
                                    <select className={fieldCls} value={searchForm.gender} onChange={(e) => onSearchFormChange({ gender: e.target.value })}>
                                        <option value="">Select</option>
                                        <option value="male">Male</option>
                                        <option value="female">Female</option>
                                        <option value="unknown">Unknown</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <FieldLabel>Height</FieldLabel>
                                    <Input placeholder="Metrics" className={fieldCls} value={searchForm.height} onChange={(e) => onSearchFormChange({ height: e.target.value })} />
                                </div>
                                <div>
                                    <FieldLabel>Threat Level</FieldLabel>
                                    <select className={fieldCls} value={searchForm.threatLevel} onChange={(e) => onSearchFormChange({ threatLevel: e.target.value })}>
                                        <option value="low">Low</option>
                                        <option value="medium">Medium</option>
                                        <option value="high">High</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <FieldLabel>Category</FieldLabel>
                                <select className={fieldCls} value={searchForm.status} onChange={(e) => onSearchFormChange({ status: e.target.value })}>
                                    <option value="wanted">Wanted</option>
                                    <option value="suspect">Suspect</option>
                                    <option value="person_of_interest">Person of Interest</option>
                                    <option value="warrant">Warrant</option>
                                    <option value="missing">Missing</option>
                                    <option value="informant">Informant</option>
                                </select>
                            </div>

                            <div>
                                <FieldLabel>Known Aliases</FieldLabel>
                                <Input placeholder="Comma separated" className={fieldCls} value={searchForm.aliases} onChange={(e) => onSearchFormChange({ aliases: e.target.value })} />
                            </div>

                            <div>
                                <FieldLabel>Field Notes</FieldLabel>
                                <textarea rows={2} placeholder="Scars, marks, last known..." className={cn(fieldCls, 'h-auto py-2 resize-none')} value={searchForm.notes} onChange={(e) => onSearchFormChange({ notes: e.target.value })} />
                            </div>
                        </div>
                    </div>

                    <div className="p-4 mt-auto border-t border-white/5 bg-white/[0.02]">
                        <Button
                            className="w-full h-8 transition-all uppercase relative overflow-hidden group bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 border border-indigo-500/20 rounded-lg text-[10px] font-mono tracking-widest shadow-none"
                            onClick={onSearchSubmit}
                            disabled={searchLoading}
                        >
                            {searchLoading ? (
                                <><Loader2 className="h-3 w-3 mr-2 animate-spin" /> PROCESSING</>
                            ) : (
                                <><Upload className="h-3 w-3 mr-2" /> ENROLL SUBJECT</>
                            )}
                        </Button>
                    </div>
                </div>

                {/* ── Center Column: Sci-Fi Scanner Engine ── */}
                <div className="flex-1 flex flex-col items-center justify-center min-h-[280px] relative px-4">

                    <div className="mb-4 text-center z-20">
                        <h3 className="text-xs font-bold text-zinc-100 tracking-[0.4em] uppercase mb-0.5 font-mono">Reference</h3>
                        <p className="text-[8px] text-zinc-500 uppercase tracking-[0.2em] font-mono opacity-60">Photo Input Component</p>
                    </div>

                    <div
                        className="relative w-[220px] h-[220px] xl:w-[260px] xl:h-[260px] flex items-center justify-center cursor-pointer group z-10"
                        onClick={() => document.getElementById('search-image-upload')?.click()}
                    >
                        {/* Outer rotating static ring */}
                        <div className="absolute inset-[-30px] rounded-full border border-indigo-500/10 border-dashed animate-[spin_60s_linear_infinite] pointer-events-none" />

                        {/* Middle rotating glowing ring */}
                        <div className="absolute inset-[-15px] rounded-full border border-indigo-500/5 shadow-[0_0_20px_rgba(99,102,241,0.03)_inset] animate-[spin_30s_linear_infinite_reverse] pointer-events-none" />

                        {/* Image Upload Core (Square-ish with rounded corners to show full photo) */}
                        <div className="absolute inset-0 rounded-2xl bg-zinc-900/60 backdrop-blur-md border border-white/5 overflow-hidden z-10 transition-all group-hover:border-indigo-500/30 group-hover:shadow-[0_0_25px_rgba(99,102,241,0.1)] flex flex-col items-center justify-center">
                            {searchPreview ? (
                                <div className="relative w-full h-full p-2">
                                    <div className="w-full h-full rounded-xl overflow-hidden relative">
                                        <img src={searchPreview} className="w-full h-full object-contain bg-black/40" alt="Scanning..." />

                                        {/* Scanning laser line animation (pure CSS) */}
                                        <div className="absolute top-0 left-0 right-0 h-1 bg-primary/80 shadow-[0_0_15px_rgba(var(--primary),0.8)] animate-[scan_3s_ease-in-out_infinite]" />

                                        {/* Tech overlay grid */}
                                        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+CiAgPHBhdGggZD0iTTAgMjAuNUMyMCAyMC41IDIwLjUgMjAgMjAuNSAwIiBmaWxsPSJub25lIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4wNSkiIHN0cm9rZS13aWR0aD0iMSIvPgo8L3N2Zz4=')] mix-blend-screen pointer-events-none" />
                                    </div>
                                </div>
                            ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center relative border-2 border-dashed border-transparent group-hover:border-primary/20 rounded-xl transition-colors m-2">
                                    <Camera className="h-10 w-10 text-zinc-600 mb-2 group-hover:text-indigo-400 transition-colors group-hover:scale-105 duration-500" />
                                    <p className="font-bold text-xs text-zinc-200 mb-1 font-mono uppercase tracking-widest">Select Image</p>
                                    <p className="text-[9px] text-zinc-500 tracking-wider uppercase font-mono">Reference Required</p>

                                    <div className="absolute bottom-6 flex gap-1.5 opacity-30">
                                        <div className="w-1 h-1 bg-indigo-500 rounded-full animate-ping" />
                                        <div className="w-1 h-1 bg-indigo-500 rounded-full animate-ping delay-75" />
                                        <div className="w-1 h-1 bg-indigo-500 rounded-full animate-ping delay-150" />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <input id="search-image-upload" type="file" className="hidden" accept="image/*" onChange={onSearchFileChange} />

                    {/* Left/Right Floating Tech Data Elements */}
                    <div className="absolute left-0 top-1/4 hidden 2xl:block opacity-40">
                        <div className="text-[10px] font-mono text-muted-foreground uppercase leading-loose tracking-widest text-right border-r border-border pr-4">
                            <p className="animate-pulse">LAT: 12.9716</p>
                            <p className="animate-pulse delay-75">LNG: 77.5946</p>
                            <p className="animate-pulse delay-150">NET: SECURE</p>
                            <p className="animate-pulse delay-300 mt-4 text-primary">DB: ONLINE</p>
                        </div>
                    </div>
                </div>

                {/* ── Right Column: Enrolled/Results Database ── */}
                <div className="w-full lg:w-[300px] xl:w-[340px] shrink-0 flex flex-col h-full bg-zinc-900/20 backdrop-blur-sm border border-white/5 rounded-xl">
                    <div className="p-3 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
                        <div className="flex items-center gap-2">
                            <Users2 className="h-3.5 w-3.5 text-zinc-500" />
                            <h2 className="text-[11px] font-mono font-bold text-zinc-400 uppercase tracking-[0.2em]">Watchlist</h2>
                        </div>
                        <div className="px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/5">
                            <span className="text-[9px] font-mono text-zinc-600">{(searchResults.length > 0 ? searchResults : persons).length}</span>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {(searchResults.length > 0 ? searchResults : persons).length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center opacity-40">
                                <ScanFace className="h-12 w-12 text-muted-foreground mb-4" />
                                <div className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground uppercase text-center leading-relaxed">
                                    Database Render<br />Offline
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3 pb-6">
                                {(searchResults.length > 0 ? searchResults : persons).map((res) => (
                                    <ResultCard key={res.id} person={res} onClick={() => onPersonClick(res)} />
                                ))}
                            </div>
                        )}
                    </div>
                </div>

            </div>

            {/* Inject central scanner CSS animation */}
            <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes scan {
                    0% { top: 0%; opacity: 0; }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { top: 100%; opacity: 0; }
                }
                .animate-\\[scan_3s_ease-in-out_infinite\\] {
                    animation: scan 3s ease-in-out infinite;
                }
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: rgba(255,255,255,0.02);
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(99,102,241,0.2);
                    border-radius: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(99,102,241,0.4);
                }
            `}} />
        </div>
    );
}

function ResultCard({ person, onClick }: { person: Person; onClick: () => void }) {
    const threat = (person.threatLevel || '').toLowerCase();
    const threatColor =
        threat === 'high' ? 'border-l-red-500' :
            threat === 'medium' ? 'border-l-amber-500' :
                'border-l-emerald-500';


    return (
        <div
            onClick={onClick}
            className={cn(
                'group relative flex gap-3 p-3 bg-zinc-900/40 border border-white/5 rounded-xl overflow-hidden min-h-[80px]',
                'hover:border-indigo-500/30 hover:bg-zinc-900/60 transition-all cursor-pointer',
                threatColor.replace('border-l-', 'border-l-[2px] ')
            )}
        >
            <div className="absolute inset-0 bg-gradient-to-r from-background/10 to-transparent pointer-events-none" />

            <div className="w-14 h-14 shrink-0 rounded bg-background/50 border border-border overflow-hidden relative">
                {person.faceImageUrl ? (
                    <img src={person.faceImageUrl} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" alt="" />
                ) : (
                    <Camera className="w-5 h-5 text-zinc-700 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                )}
                {/* Tech corner accents */}
                <div className="absolute top-0 left-0 w-1.5 h-1.5 border-t border-l border-white/40" />
                <div className="absolute bottom-0 right-0 w-1.5 h-1.5 border-b border-r border-white/40" />
            </div>

            <div className="flex-1 min-w-0 flex flex-col justify-center relative z-10">
                <div className="flex items-center justify-between mb-1">
                    <h4 className="text-[11px] font-bold text-foreground uppercase tracking-tight truncate pr-2">{person.name}</h4>
                    <span className="text-[9px] text-muted-foreground font-mono tracking-widest hidden sm:inline-block">ID:{person.id.slice(0, 4)}</span>
                </div>

                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                    <ThreatBadge level={person.threatLevel} />
                    <CategoryBadge category={person.category} />
                </div>

                <div className="flex items-center gap-3 text-[10px] text-muted-foreground uppercase tracking-wider">
                    {person.gender && <span>{person.gender}</span>}
                    {person.age && <span>{person.age} YO</span>}
                </div>
            </div>
        </div>

    );
}
