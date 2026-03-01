import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, FileText, Download } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { FRSReportPDF } from '@/components/crowd/FRSReportPDF';
import { recordReportEvent } from '@/lib/reportHistory';
import type { Person, FRSMatch } from '@/lib/api';

interface FRSReportModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    persons: Person[];
    detections: FRSMatch[];
    timeRange: string;
}

export function FRSReportModal({ open, onOpenChange, persons, detections, timeRange }: FRSReportModalProps) {
    const [title, setTitle] = useState('FRS Analytics Report');
    const [filter, setFilter] = useState<'all' | 'known' | 'unknown' | 'high_threat'>('all');
    const [generating, setGenerating] = useState(false);

    const handleGenerate = async () => {
        try {
            setGenerating(true);

            // Filter Detections
            let filteredDetections = detections;
            if (filter === 'known') {
                filteredDetections = detections.filter(d => !!d.personId);
            } else if (filter === 'unknown') {
                filteredDetections = detections.filter(d => !d.personId);
            } else if (filter === 'high_threat') {
                const highThreatPersons = new Set(
                    persons.filter(p => p.threatLevel?.toLowerCase() === 'high').map(p => String(p.id))
                );
                filteredDetections = detections.filter(d => d.personId && highThreatPersons.has(String(d.personId)));
            }

            const generatedAt = new Date().toLocaleString();

            const doc = (
                <FRSReportPDF
                    persons={persons}
                    detections={filteredDetections}
                    reportTitle={title}
                    generatedAt={generatedAt}
                    filters={{
                        watchlistFilter: filter,
                        searchQuery: `TimeRange: ${timeRange}`
                    }}
                />
            );

            const asPdf = pdf(doc);
            const blob = await asPdf.toBlob();
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `frs_report_${new Date().getTime()}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Record to history
            recordReportEvent({
                title,
                module: 'FRS Analytics',
                route: '/analytics',
                format: 'pdf',
                status: 'downloaded',
                query: `Filter: ${filter}, Time: ${timeRange}`,
            });

            onOpenChange(false);
        } catch (e) {
            console.error('Failed to generate PDF:', e);
        } finally {
            setGenerating(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px] bg-zinc-950 border border-white/10 text-zinc-100">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-indigo-400" />
                        Generate PDF Report
                    </DialogTitle>
                    <DialogDescription className="text-zinc-400 text-xs">
                        Export a high-quality PDF report of FRS Analytics with the current data.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Report Title</label>
                        <Input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="bg-zinc-900 border-white/10 text-sm font-mono"
                        />
                    </div>

                    <div className="grid gap-2">
                        <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider">Data Filter</label>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                { id: 'all', label: 'All Detections' },
                                { id: 'known', label: 'Known Matches' },
                                { id: 'unknown', label: 'Unknown Faces' },
                                { id: 'high_threat', label: 'High Threat' },
                            ].map((f) => (
                                <button
                                    key={f.id}
                                    onClick={() => setFilter(f.id as any)}
                                    className={`px-3 py-2 text-xs font-mono rounded-md border transition-colors text-left ${filter === f.id
                                            ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                                            : 'bg-zinc-900/50 border-white/5 text-zinc-400 hover:text-zinc-200'
                                        }`}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono mt-1">
                        Data included: {timeRange} • {persons.length} Watchlist • {detections.length} Detections
                    </div>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        className="border-white/10 hover:bg-white/5 text-zinc-300"
                        disabled={generating}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleGenerate}
                        disabled={generating || detections.length === 0}
                        className="bg-indigo-600 hover:bg-indigo-500 text-white"
                    >
                        {generating ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                            <Download className="w-4 h-4 mr-2" />
                        )}
                        Download PDF
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
