import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { recordReportEvent } from './reportHistory';


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function exportToCSV(data: any[], filename: string) {
  if (!data || data.length === 0) {
    console.warn('No data to export');
    return;
  }

  // Get headers from first object
  const headers = Object.keys(data[0]);

  // Create CSV content
  const csvContent = [
    headers.join(','), // Header row
    ...data.map(row =>
      headers.map(header => {
        const value = row[header];
        // Handle strings with commas by wrapping in quotes
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value}"`;
        }
        return value;
      }).join(',')
    )
  ].join('\n');

  // Create Blob and download link
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    const lower = filename.toLowerCase();
    let module = 'Analytics';
    let route = '/reports';
    if (lower.includes('vehicle')) {
      module = 'ITMS';
      route = '/itms/anpr';
    } else if (lower.includes('device')) {
      module = 'System';
      route = '/settings/workers';
    } else if (lower.includes('trend') || lower.includes('analytics')) {
      module = 'Analytics';
      route = '/dashboard';
    }
    recordReportEvent({
      title: filename,
      module,
      route,
      format: 'csv',
      status: 'downloaded',
    });
  }
}
