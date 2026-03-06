import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, FileText, Download, Calendar } from 'lucide-react';
import { recordReportEvent } from '@/lib/reportHistory';
import { saveReportBlob } from '@/lib/reportStorage';
import { cn } from '@/lib/utils';
import type { Person, FRSMatch } from '@/lib/api';
import { useToast } from '@/components/ui/use-toast';

interface FRSReportModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    persons: Person[];
    detections: FRSMatch[];
    timeRange: string;
}

export function FRSReportModal({ open, onOpenChange, persons: _persons, detections: _detections, timeRange }: FRSReportModalProps) {
    const { toast } = useToast();
    const [title, setTitle] = useState('FRS Analytics Report');
    const [filter, setFilter] = useState<'all' | 'known' | 'unknown'>('all');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [generating, setGenerating] = useState(false);

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            const params = new URLSearchParams({ title, filter });
            if (startDate) params.set('startTime', new Date(startDate + 'T00:00:00').toISOString());
            if (endDate) params.set('endTime', new Date(endDate + 'T23:59:59').toISOString());
            const humanRange = startDate || endDate
                ? `${startDate || 'Start'} to ${endDate || 'Now'}`
                : timeRange;
            params.set('timeRange', humanRange);

            const token = localStorage.getItem('iris_token');
            const res = await fetch(`/api/frs/report?${params}`, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {},
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Report generation failed');
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const filename = `FRS-Analytics-${Date.now()}.pdf`;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            const entry = recordReportEvent({
                title: filename,
                module: 'FRS Analytics',
                route: '/analytics',
                format: 'pdf',
                status: 'generated',
                query: `Filter: ${filter}, Date: ${startDate} to ${endDate}`,
            });

            await saveReportBlob(entry.id, blob);
            onOpenChange(false);
            toast({ title: 'Export Complete', description: 'Report generated and saved to archive.' });
        } catch (e: any) {
            console.error('Failed to generate report:', e);
            toast({ title: 'Export Failed', description: e.message || 'Could not generate PDF report.', variant: 'destructive' });
        } finally {
            setGenerating(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-sm p-6 gap-0 border border-white/5 bg-zinc-950/96 backdrop-blur-sm text-zinc-100 shadow-2xl">
                <DialogHeader className="mb-6">
                    <DialogTitle className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                        <FileText className="w-5 h-5 text-indigo-400" />
                        Export FRS Report
                    </DialogTitle>
                    <DialogDescription className="text-xs text-zinc-500 mt-1">
                        Select filter criteria and date range for the PDF export.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-1.5">
                        <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Report Title</label>
                        <Input
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="h-9 bg-black/30 border-white/10 text-zinc-100 placeholder:text-zinc-600 text-xs focus:ring-1 focus:ring-indigo-500/20"
                            placeholder="e.g. Weekly Security Audit"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Detection Filter</label>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { id: 'all', label: 'All' },
                                { id: 'known', label: 'Known' },
                                { id: 'unknown', label: 'Unknown' },
                            ].map((f) => (
                                <button
                                    key={f.id}
                                    onClick={() => setFilter(f.id as any)}
                                    className={cn(
                                        "h-8 px-2 text-[10px] font-mono rounded border transition-all",
                                        filter === f.id
                                            ? "bg-indigo-500/20 border-indigo-500/50 text-indigo-300"
                                            : "bg-black/20 border-white/5 text-zinc-500 hover:text-zinc-300 hover:border-white/10"
                                    )}
                                >
                                    {f.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
                                <Calendar className="w-3 h-3" /> Start
                            </label>
                            <Input
                                type="date"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="h-9 bg-black/30 border-white/10 text-zinc-100 text-[10px] focus:ring-1 focus:ring-indigo-500/20 px-2"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest flex items-center gap-1.5">
                                <Calendar className="w-3 h-3" /> End
                            </label>
                            <Input
                                type="date"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="h-9 bg-black/30 border-white/10 text-zinc-100 text-[10px] focus:ring-1 focus:ring-indigo-500/20 px-2"
                            />
                        </div>
                    </div>

                    <p className="text-[10px] text-zinc-600 font-mono italic">
                        Empty dates will include all-time data.
                    </p>
                </div>

                <div className="flex gap-2 mt-8">
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        className="flex-1 h-9 text-xs border-white/10 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                        disabled={generating}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="flex-1 h-9 text-xs bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"
                    >
                        {generating ? (
                            <>
                                <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                                Exporting...
                            </>
                        ) : (
                            <>
                                <Download className="w-3.5 h-3.5 mr-2" />
                                Download PDF
                            </>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
