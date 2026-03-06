import { Search, Plus, FileText, Users, Activity } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PersonCard } from './FRSShared';
import type { Person } from '@/lib/api';
import { cn } from '@/lib/utils';

interface WatchlistTabProps {
    persons: Person[];
    filteredPersons: Person[];
    searchQuery: string;
    watchlistFilter: 'all' | 'high' | 'wanted';
    highThreatCount: number;
    wantedCount: number;
    isExporting: boolean;
    onSearchChange: (query: string) => void;
    onFilterChange: (filter: 'all' | 'high' | 'wanted') => void;
    onEnrollClick: () => void;
    onExportClick: () => void;
    onPersonClick: (person: Person) => void;
    onEditClick: (person: Person) => void;
    onRefresh: () => void;
}

export function WatchlistTab({
    persons,
    filteredPersons,
    searchQuery,
    watchlistFilter,
    highThreatCount,
    wantedCount,
    isExporting,
    onSearchChange,
    onFilterChange,
    onEnrollClick,
    onExportClick,
    onPersonClick
}: WatchlistTabProps) {
    return (
        <div className="h-full m-0 flex flex-col gap-4 overflow-hidden p-1">
            <div className="shrink-0 flex flex-col md:flex-row items-center gap-3 p-1 overflow-hidden">
                <div className="relative flex-1 w-full md:max-w-md group">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600 group-focus-within:text-indigo-400/60 transition-colors" />
                    <Input
                        placeholder="Search people..."
                        className="h-9 pl-11 rounded-sm bg-white/[0.03] border-white/5 text-zinc-100 placeholder:text-zinc-700 focus:border-indigo-500/20 focus:ring-1 focus:ring-indigo-500/10 font-mono text-xs uppercase tracking-tighter transition-all"
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                    />
                </div>

                <div className="flex items-center gap-1.5 p-1 rounded-sm bg-black/5 border border-white/5 h-9 w-full md:w-auto overflow-x-auto no-scrollbar">
                    {(['all', 'high', 'wanted'] as const).map((f) => (
                        <Button
                            key={f}
                            variant="ghost"
                            size="sm"
                            className={cn(
                                "h-8 px-4 text-[10px] font-bold uppercase tracking-wider transition-all rounded-md",
                                watchlistFilter === f
                                    ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/20"
                                    : "text-zinc-600 hover:text-zinc-400 hover:bg-white/5 border border-transparent"
                            )}
                            onClick={() => onFilterChange(f)}
                        >
                            {f === 'all' ? `All (${persons.length})` : f === 'high' ? `High (${highThreatCount})` : `Wanted (${wantedCount})`}
                        </Button>
                    ))}
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto ml-auto">
                    <Button
                        size="sm"
                        className="flex-1 md:flex-none h-9 rounded-sm bg-indigo-500/90 hover:bg-indigo-500 text-white border border-indigo-400/30 font-bold uppercase tracking-wider text-[10px] items-center gap-2"
                        onClick={onEnrollClick}
                    >
                        <Plus className="h-4 w-4" /> Add Person
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 md:flex-none h-9 rounded-sm border-white/10 bg-transparent text-zinc-400 hover:text-white hover:bg-white/5 font-bold uppercase tracking-wider text-[10px] items-center gap-2"
                        onClick={onExportClick}
                        disabled={isExporting}
                    >
                        <FileText className="h-4 w-4" />
                        {isExporting ? 'Exporting' : 'Export'}
                    </Button>
                </div>
            </div>

            <div className="shrink-0 flex items-center gap-4 px-1 overflow-x-auto no-scrollbar pb-2">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/5 bg-white/5">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">Total</span>
                    <span className="text-[10px] font-mono font-bold text-zinc-300">{persons.length}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/5">
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    <span className="text-[10px] font-mono text-red-500/70 uppercase tracking-tighter">High threat</span>
                    <span className="text-[10px] font-mono font-bold text-red-400">{highThreatCount}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 dark:bg-amber-500/10">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span className="text-[10px] font-mono text-amber-600/80 dark:text-amber-500/70 uppercase tracking-tighter">Wanted</span>
                    <span className="text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400">{wantedCount}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 ml-auto">
                    <Activity className="h-3 w-3 text-emerald-400" />
                    <span className="text-[10px] font-mono text-emerald-400/70 uppercase tracking-tighter">Status</span>
                    <span className="text-[10px] font-mono font-bold text-emerald-400">Ready</span>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pr-1 iris-scroll-area">
                {filteredPersons.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-zinc-700 bg-zinc-900/30 border border-border/40 backdrop-blur-sm rounded-xl py-12">
                        <div className="relative mb-6">
                            <Users className="h-16 w-16 opacity-10" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Search className="h-8 w-8 opacity-20" />
                            </div>
                        </div>
                        <p className="text-sm font-bold text-zinc-400 uppercase tracking-[0.2em]">No matches</p>
                        <p className="text-[10px] font-mono text-zinc-600 mt-2 uppercase tracking-tight">Try a different search or filter</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 pb-6">
                        {filteredPersons.map((person, idx) => (
                            <PersonCard
                                key={person.id}
                                person={person}
                                idx={idx}
                                onClick={() => onPersonClick(person)}
                            />
                        ))}
                    </div>
                )}
            </div>

            <div className="shrink-0 flex items-center justify-between px-2 py-3 border-t border-white/5 mt-auto">
                <div className="flex items-center gap-4 text-[10px] font-mono text-zinc-600 uppercase">
                    <span className="flex items-center gap-1.5"><div className="w-1 h-1 bg-zinc-700" /> Registry view</span>
                    <span className="flex items-center gap-1.5"><div className="w-1 h-1 bg-zinc-700" /> Page 1 / 1</span>
                </div>
                <div className="text-[10px] font-mono text-zinc-500">
                    Showing {filteredPersons.length} of {persons.length}
                </div>
            </div>
        </div>
    );
}
