// Formatting utilities for ITMS widgets
export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTimeAgo(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0';
  return value.toLocaleString();
}

export function getViolationTypeColor(type: string): string {
  const colors: Record<string, string> = {
    SPEED: 'bg-red-500',
    HELMET: 'bg-orange-500',
    WRONG_SIDE: 'bg-yellow-500',
    RED_LIGHT: 'bg-purple-500',
    NO_SEATBELT: 'bg-pink-500',
    OVERLOADING: 'bg-indigo-500',
    ILLEGAL_PARKING: 'bg-gray-500',
    TRIPLE_RIDING: 'bg-cyan-500',
    WRONG_LANE: 'bg-indigo-600',
    OTHER: 'bg-blue-500',
  };
  return colors[type] || 'bg-gray-500';
}

export function getViolationTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    SPEED: 'Speed',
    HELMET: 'Helmet',
    WRONG_SIDE: 'Wrong Side',
    RED_LIGHT: 'Red Light',
    NO_SEATBELT: 'No Seatbelt',
    OVERLOADING: 'Overloading',
    ILLEGAL_PARKING: 'Parking',
    TRIPLE_RIDING: 'Triple Riding',
    WRONG_LANE: 'Wrong Lane',
    OTHER: 'Other',
  };
  return labels[type] || type;
}

export function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    PENDING: 'bg-yellow-500',
    APPROVED: 'bg-green-500',
    REJECTED: 'bg-red-500',
    FINED: 'bg-blue-500',
  };
  return colors[status] || 'bg-gray-500';
}

