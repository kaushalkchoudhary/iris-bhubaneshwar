export type ReportStatus = 'generated' | 'downloaded';

export interface ReportHistoryEntry {
  id: string;
  title: string;
  module: string;
  route: string;
  format: 'pdf' | 'csv' | 'xlsx' | 'json' | 'other';
  status: ReportStatus;
  generatedAt: string;
  query?: string;
  notes?: string;
}

const STORAGE_KEY = 'iris_report_history_v1';
const MAX_ENTRIES = 500;

export function getReportHistory(): ReportHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean) as ReportHistoryEntry[];
  } catch {
    return [];
  }
}

export function saveReportHistory(entries: ReportHistoryEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // ignore storage failures
  }
}

export function recordReportEvent(input: Omit<ReportHistoryEntry, 'id' | 'generatedAt'> & { generatedAt?: string }): ReportHistoryEntry {
  const entry: ReportHistoryEntry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    generatedAt: input.generatedAt || new Date().toISOString(),
    ...input,
  };
  const current = getReportHistory();
  saveReportHistory([entry, ...current]);
  return entry;
}

export function clearReportHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
