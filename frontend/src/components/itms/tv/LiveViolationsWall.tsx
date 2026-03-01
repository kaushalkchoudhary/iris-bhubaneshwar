import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient, type TrafficViolation } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { formatTimeAgo, getViolationTypeLabel, getViolationTypeColor } from '../widgets';
import { cn } from '@/lib/utils';
import { playSound } from '@/hooks/useSound';
import {
  Camera, RotateCcw, MapPin, Clock, Gauge, Car, ThumbsUp, ThumbsDown, Shield
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

type SwipeDirection = 'left' | 'right' | null;

interface ReviewedViolation {
  violation: TrafficViolation;
  action: 'APPROVED' | 'REJECTED';
}

export function LiveViolationsWall() {
  const [violations, setViolations] = useState<TrafficViolation[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  const filterType = searchParams.get('type') || undefined;

  // Swipe state
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [exitDirection, setExitDirection] = useState<SwipeDirection>(null);
  const [isAnimatingExit, setIsAnimatingExit] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragStartX = useRef(0);

  // Review tracking
  const [reviewedStack, setReviewedStack] = useState<ReviewedViolation[]>([]);
  const [stats, setStats] = useState({ approved: 0, rejected: 0 });
  const [actionFeedback, setActionFeedback] = useState<'APPROVED' | 'REJECTED' | null>(null);

  const fetchViolations = async () => {
    try {
      setLoading(true);
      const result = await apiClient.getViolations({
        status: 'PENDING',
        limit: 50,
        violationType: filterType as any,
      });
      setViolations(result.violations);
      if (result.violations.length > 0 && currentIndex >= result.violations.length) {
        setCurrentIndex(0);
      }
    } catch (err) {
      console.error('Failed to fetch violations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchViolations();
  }, [filterType]);

  const currentViolation = violations[currentIndex];
  const nextViolation = violations[currentIndex + 1];

  const performAction = useCallback(async (direction: SwipeDirection) => {
    if (!currentViolation || isAnimatingExit) return;

    const action = direction === 'right' ? 'APPROVED' : 'REJECTED';

    setExitDirection(direction);
    setIsAnimatingExit(true);
    setActionFeedback(action);

    try {
      if (action === 'APPROVED') {
        await apiClient.approveViolation(currentViolation.id);
        playSound('success');
      } else {
        await apiClient.rejectViolation(currentViolation.id, {
          rejectionReason: 'Rejected via swipe review',
        });
        playSound('error');
      }
    } catch (err) {
      console.error(`Failed to ${action.toLowerCase()} violation:`, err);
    }

    setReviewedStack(prev => [...prev, { violation: currentViolation, action }]);
    setStats(prev => ({
      ...prev,
      [action === 'APPROVED' ? 'approved' : 'rejected']: prev[action === 'APPROVED' ? 'approved' : 'rejected'] + 1,
    }));

    setTimeout(() => {
      setExitDirection(null);
      setIsAnimatingExit(false);
      setDragX(0);
      setActionFeedback(null);

      setViolations(prev => prev.filter((_, i) => i !== currentIndex));
      if (currentIndex >= violations.length - 1) {
        setCurrentIndex(0);
        fetchViolations();
      }
    }, 450);
  }, [currentViolation, currentIndex, violations.length, isAnimatingExit]);

  const handleUndo = useCallback(async () => {
    if (reviewedStack.length === 0) return;
    const last = reviewedStack[reviewedStack.length - 1];
    setReviewedStack(prev => prev.slice(0, -1));
    setStats(prev => ({
      ...prev,
      [last.action === 'APPROVED' ? 'approved' : 'rejected']:
        prev[last.action === 'APPROVED' ? 'approved' : 'rejected'] - 1,
    }));
    setViolations(prev => {
      const next = [...prev];
      next.splice(currentIndex, 0, last.violation);
      return next;
    });
  }, [reviewedStack, currentIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isAnimatingExit) return;
      if (e.key === 'ArrowRight' || e.key === 'd') {
        performAction('right');
      } else if (e.key === 'ArrowLeft' || e.key === 'a') {
        performAction('left');
      } else if ((e.key === 'z' && (e.metaKey || e.ctrlKey)) || e.key === 'u') {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [performAction, handleUndo, isAnimatingExit]);

  // Mouse/touch drag
  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (isAnimatingExit) return;
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    dragStartX.current = clientX;
  };
  const handleDragMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    setDragX(clientX - dragStartX.current);
  };
  const handleDragEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const threshold = 100;
    if (dragX > threshold) performAction('right');
    else if (dragX < -threshold) performAction('left');
    else setDragX(0);
  };

  const swipeProgress = Math.min(Math.abs(dragX) / 100, 1);
  const swipeDirection: SwipeDirection = dragX > 15 ? 'right' : dragX < -15 ? 'left' : null;

  const getCardTransform = (): React.CSSProperties => {
    if (exitDirection) {
      return {
        transform: `translateX(${exitDirection === 'right' ? '110%' : '-110%'}) rotate(${exitDirection === 'right' ? '8' : '-8'}deg)`,
        transition: 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.45s ease',
        opacity: 0,
      };
    }
    const rotation = (dragX / window.innerWidth) * 12;
    return {
      transform: `translateX(${dragX}px) rotate(${rotation}deg)`,
      transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.2, 0, 0, 1)',
    };
  };

  const totalReviewed = stats.approved + stats.rejected;
  const totalItems = totalReviewed + violations.length;
  const progressPercent = totalItems > 0 ? (totalReviewed / totalItems) * 100 : 0;

  // Loading state
  if (loading && violations.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950">
        <div className="text-center">
          <div className="relative mx-auto mb-8 w-24 h-24">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-900 animate-pulse" />
            <div className="absolute inset-0 rounded-2xl border border-zinc-700/50" />
            <Camera className="absolute inset-0 m-auto w-10 h-10 text-zinc-600" />
          </div>
          <p className="text-zinc-400 text-lg font-medium tracking-tight">Loading violations...</p>
        </div>
      </div>
    );
  }

  // Empty / all-done state
  if (violations.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="relative mx-auto mb-8 w-28 h-28">
            <div className="absolute inset-0 rounded-full bg-emerald-500/5" />
            <div className="absolute inset-2 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <Shield className="w-12 h-12 text-emerald-500/80" />
            </div>
          </div>
          <h2 className="text-zinc-200 text-2xl font-semibold tracking-tight">Queue clear</h2>
          <p className="text-zinc-500 text-sm mt-2 leading-relaxed">
            No pending violations. New detections will appear here automatically.
          </p>

          {totalReviewed > 0 && (
            <div className="mt-8 flex items-center justify-center gap-8">
              <div className="text-center">
                <div className="text-3xl font-bold text-emerald-400 tabular-nums">{stats.approved}</div>
                <div className="text-[11px] text-zinc-500 mt-1 uppercase tracking-wider">Approved</div>
              </div>
              <div className="w-px h-10 bg-zinc-800" />
              <div className="text-center">
                <div className="text-3xl font-bold text-red-400 tabular-nums">{stats.rejected}</div>
                <div className="text-[11px] text-zinc-500 mt-1 uppercase tracking-wider">Rejected</div>
              </div>
            </div>
          )}

          <button
            onClick={fetchViolations}
            className="mt-8 px-5 py-2.5 rounded-xl bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 text-sm font-medium transition-all border border-zinc-700/50 hover:border-zinc-600/50"
          >
            Check again
          </button>
        </div>
      </div>
    );
  }

  if (!currentViolation) return null;

  const confidencePercent = currentViolation.confidence != null
    ? Math.round(currentViolation.confidence * 100)
    : currentViolation.plateConfidence != null
      ? Math.round(currentViolation.plateConfidence * 100)
      : null;

  return (
    <div
      className="h-full overflow-hidden bg-zinc-950 relative select-none"
      onMouseMove={handleDragMove}
      onMouseUp={handleDragEnd}
      onMouseLeave={handleDragEnd}
      onTouchMove={handleDragMove}
      onTouchEnd={handleDragEnd}
    >
      <style>{`
        @keyframes cardEnter {
          from { opacity: 0; transform: scale(0.95) translateY(12px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes stampPop {
          0% { transform: scale(2.5) rotate(var(--stamp-rotate)); opacity: 0; }
          50% { transform: scale(0.95) rotate(var(--stamp-rotate)); opacity: 1; }
          100% { transform: scale(1) rotate(var(--stamp-rotate)); opacity: 0.9; }
        }
      `}</style>

      {/* Full-screen layout: image left, details right */}
      <div className="h-full flex">

        {/* Left: Card image area */}
        <div className="flex-1 relative flex items-center justify-center p-6 overflow-hidden">

          {/* Reject zone indicator (left edge) */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1 z-20 transition-all duration-150"
            style={{
              backgroundColor: swipeDirection === 'left' ? `rgba(239, 68, 68, ${swipeProgress * 0.8})` : 'transparent',
              boxShadow: swipeDirection === 'left' ? `0 0 ${40 * swipeProgress}px ${20 * swipeProgress}px rgba(239, 68, 68, ${swipeProgress * 0.3})` : 'none',
            }}
          />
          {/* Approve zone indicator (right edge of image area) */}
          <div
            className="absolute right-0 top-0 bottom-0 w-1 z-20 transition-all duration-150"
            style={{
              backgroundColor: swipeDirection === 'right' ? `rgba(16, 185, 129, ${swipeProgress * 0.8})` : 'transparent',
              boxShadow: swipeDirection === 'right' ? `0 0 ${40 * swipeProgress}px ${20 * swipeProgress}px rgba(16, 185, 129, ${swipeProgress * 0.3})` : 'none',
            }}
          />

          {/* Background/next card peek */}
          {nextViolation && (
            <div
              className="absolute rounded-2xl overflow-hidden bg-zinc-900 border border-zinc-800/50"
              style={{
                width: 'calc(100% - 80px)',
                height: 'calc(100% - 80px)',
                transform: `scale(${0.94 + swipeProgress * 0.03})`,
                opacity: 0.3 + swipeProgress * 0.4,
                transition: isDragging ? 'none' : 'all 0.4s ease',
              }}
            >
              {(nextViolation.fullSnapshotUrl || nextViolation.plateImageUrl) && (
                <img
                  src={nextViolation.fullSnapshotUrl || nextViolation.plateImageUrl || ''}
                  alt="" className="w-full h-full object-cover opacity-30"
                />
              )}
            </div>
          )}

          {/* Active card */}
          <div
            ref={cardRef}
            className="relative rounded-2xl overflow-hidden cursor-grab active:cursor-grabbing shadow-2xl shadow-black/60"
            style={{
              width: 'calc(100% - 48px)',
              height: 'calc(100% - 48px)',
              animation: 'cardEnter 0.4s cubic-bezier(0.2, 0, 0, 1)',
              ...getCardTransform(),
            }}
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
          >
            {/* Image */}
            {(currentViolation.fullSnapshotUrl || currentViolation.plateImageUrl) ? (
              <img
                src={currentViolation.fullSnapshotUrl || currentViolation.plateImageUrl || ''}
                alt="Violation" className="w-full h-full object-cover" draggable={false}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-zinc-900">
                <Camera className="w-20 h-20 text-zinc-800" />
              </div>
            )}

            {/* Subtle vignette */}
            <div className="absolute inset-0 shadow-[inset_0_0_80px_rgba(0,0,0,0.5)]" />

            {/* Swipe color overlays */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: swipeDirection === 'right'
                  ? `linear-gradient(135deg, rgba(16, 185, 129, ${swipeProgress * 0.25}), transparent 60%)`
                  : swipeDirection === 'left'
                    ? `linear-gradient(225deg, rgba(239, 68, 68, ${swipeProgress * 0.25}), transparent 60%)`
                    : 'none',
              }}
            />

            {/* APPROVE stamp */}
            {swipeDirection === 'right' && swipeProgress > 0.35 && (
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{ '--stamp-rotate': '-12deg', animation: 'stampPop 0.3s ease forwards', opacity: swipeProgress } as React.CSSProperties}
              >
                <div className="px-8 py-4 border-4 border-emerald-400 rounded-xl bg-emerald-500/10 backdrop-blur-sm">
                  <span className="text-5xl font-black text-emerald-400 tracking-widest">APPROVE</span>
                </div>
              </div>
            )}

            {/* REJECT stamp */}
            {swipeDirection === 'left' && swipeProgress > 0.35 && (
              <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                style={{ '--stamp-rotate': '12deg', animation: 'stampPop 0.3s ease forwards', opacity: swipeProgress } as React.CSSProperties}
              >
                <div className="px-8 py-4 border-4 border-red-400 rounded-xl bg-red-500/10 backdrop-blur-sm">
                  <span className="text-5xl font-black text-red-400 tracking-widest">REJECT</span>
                </div>
              </div>
            )}

            {/* Top-left badge */}
            <div className="absolute top-5 left-5">
              <Badge className={cn(
                "text-sm px-4 py-1.5 font-semibold shadow-lg backdrop-blur-sm",
                getViolationTypeColor(currentViolation.violationType)
              )}>
                {getViolationTypeLabel(currentViolation.violationType)}
              </Badge>
            </div>
          </div>
        </div>

        {/* Right: Details panel */}
        <div className="w-[380px] flex-shrink-0 bg-zinc-900/50 border-l border-zinc-800/50 flex flex-col">

          {/* Progress header */}
          <div className="p-5 border-b border-zinc-800/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] text-zinc-500 uppercase tracking-widest font-medium">Review Progress</span>
              <span className="text-xs text-zinc-400 tabular-nums font-medium">
                {totalReviewed} / {totalItems}
              </span>
            </div>
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${progressPercent}%`,
                  background: 'linear-gradient(90deg, #10b981, #34d399)',
                }}
              />
            </div>
            <div className="flex items-center justify-between mt-3 gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-zinc-400 tabular-nums">{stats.approved} approved</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-xs text-zinc-400 tabular-nums">{stats.rejected} rejected</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-zinc-600" />
                <span className="text-xs text-zinc-400 tabular-nums">{violations.length} left</span>
              </div>
            </div>
          </div>

          {/* Violation details */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5" style={{ animation: 'slideUp 0.3s ease' }}>

            {/* Plate number - hero */}
            {currentViolation.plateNumber && (
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">License Plate</div>
                <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-zinc-800/60 border border-zinc-700/40">
                  <Car size={18} className="text-indigo-400 flex-shrink-0" />
                  <span className="text-2xl font-bold text-zinc-100 font-mono tracking-[0.15em]">
                    {currentViolation.plateNumber}
                  </span>
                </div>
              </div>
            )}

            {/* Confidence */}
            {confidencePercent !== null && (
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Detection Confidence</div>
                <div className="px-4 py-3 rounded-xl bg-zinc-800/60 border border-zinc-700/40">
                  <div className="flex items-center justify-between mb-2">
                    <span className={cn(
                      "text-lg font-bold tabular-nums",
                      confidencePercent >= 80 ? 'text-emerald-400' :
                      confidencePercent >= 50 ? 'text-amber-400' : 'text-red-400'
                    )}>
                      {confidencePercent}%
                    </span>
                    <span className={cn(
                      "text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-md",
                      confidencePercent >= 80 ? 'text-emerald-400 bg-emerald-500/10' :
                      confidencePercent >= 50 ? 'text-amber-400 bg-amber-500/10' : 'text-red-400 bg-red-500/10'
                    )}>
                      {confidencePercent >= 80 ? 'High' : confidencePercent >= 50 ? 'Medium' : 'Low'}
                    </span>
                  </div>
                  <div className="h-1 bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all",
                        confidencePercent >= 80 ? 'bg-emerald-500' :
                        confidencePercent >= 50 ? 'bg-amber-500' : 'bg-red-500'
                      )}
                      style={{ width: `${confidencePercent}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Meta details */}
            <div className="space-y-2">
              {currentViolation.device && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-zinc-800/40">
                  <MapPin size={14} className="text-zinc-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Device</div>
                    <div className="text-sm text-zinc-300 truncate">{currentViolation.device.name || currentViolation.deviceId}</div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-zinc-800/40">
                <Clock size={14} className="text-zinc-500 flex-shrink-0" />
                <div>
                  <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Detected</div>
                  <div className="text-sm text-zinc-300">{formatTimeAgo(currentViolation.timestamp)}</div>
                  <div className="text-[11px] text-zinc-500">{new Date(currentViolation.timestamp).toLocaleString()}</div>
                </div>
              </div>
              {currentViolation.detectedSpeed != null && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-zinc-800/40">
                  <Gauge size={14} className="text-zinc-500 flex-shrink-0" />
                  <div>
                    <div className="text-[10px] text-zinc-600 uppercase tracking-wider">Speed</div>
                    <div className="text-sm text-zinc-300">
                      <span className="font-semibold">{currentViolation.detectedSpeed}</span> km/h
                      {currentViolation.speedOverLimit != null && (
                        <span className="text-red-400 ml-2 text-xs">+{currentViolation.speedOverLimit} over</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Plate crop if available */}
            {currentViolation.plateImageUrl && currentViolation.fullSnapshotUrl && (
              <div>
                <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Plate Crop</div>
                <div className="rounded-lg overflow-hidden border border-zinc-700/40 bg-zinc-800/40">
                  <img
                    src={currentViolation.plateImageUrl}
                    alt="Plate"
                    className="w-full h-auto max-h-24 object-contain bg-black"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="p-5 border-t border-zinc-800/50 space-y-4">

            {/* Action feedback */}
            {actionFeedback && (
              <div className={cn(
                "text-center py-2 rounded-lg text-sm font-semibold",
                "animate-[fadeIn_0.2s_ease]",
                actionFeedback === 'APPROVED'
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : 'bg-red-500/10 text-red-400'
              )}>
                {actionFeedback === 'APPROVED' ? 'Approved' : 'Rejected'}
              </div>
            )}

            <div className="flex items-center gap-3">
              {/* Reject */}
              <button
                onClick={() => performAction('left')}
                disabled={isAnimatingExit}
                className="flex-1 group flex items-center justify-center gap-2 h-12 rounded-xl bg-zinc-800/80 border border-red-500/20 hover:border-red-500/50 hover:bg-red-500/10 active:scale-[0.97] transition-all duration-150 disabled:opacity-40"
              >
                <ThumbsDown size={16} className="text-red-400" />
                <span className="text-sm font-semibold text-red-400">Reject</span>
              </button>

              {/* Undo */}
              <button
                onClick={handleUndo}
                disabled={reviewedStack.length === 0}
                title="Undo (Ctrl+Z)"
                className="flex items-center justify-center w-12 h-12 rounded-xl bg-zinc-800/80 border border-zinc-700/50 hover:border-zinc-600 hover:bg-zinc-700/30 active:scale-[0.97] transition-all duration-150 disabled:opacity-40"
              >
                <RotateCcw size={16} className="text-zinc-400" />
              </button>

              {/* Approve */}
              <button
                onClick={() => performAction('right')}
                disabled={isAnimatingExit}
                className="flex-1 group flex items-center justify-center gap-2 h-12 rounded-xl bg-zinc-800/80 border border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-500/10 active:scale-[0.97] transition-all duration-150 disabled:opacity-40"
              >
                <ThumbsUp size={16} className="text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-400">Approve</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
