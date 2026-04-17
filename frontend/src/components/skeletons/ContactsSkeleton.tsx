import React from 'react';
import { SkeletonBlock, SkeletonAvatar, SkeletonBadge } from '../ui/Skeleton';
import { useAdaptiveRows } from '../../hooks/useAdaptiveCount';

export function ContactsSkeleton() {
  const rowCount = useAdaptiveRows({
    rowHeight: 62,
    minRows: 5,
    maxRows: 12,
    viewportOffset: 320,
  });

  return (
    <div className="p-6 space-y-4">
      {/* Search + filter row */}
      <div className="animate-pulse flex gap-3">
        <SkeletonBlock className="h-9 flex-1 rounded-lg" />
        <SkeletonBlock className="h-9 w-28 rounded-lg" />
      </div>
      {/* Contact rows */}
      <div className="space-y-2">
        {Array.from({ length: rowCount }, (_, i) => (
          <div key={i} className="animate-pulse flex items-center gap-3 p-3 rounded-lg border border-slate-100">
            <SkeletonAvatar className="h-9 w-9" />
            <div className="flex-1 space-y-1">
              <SkeletonBlock className={`h-3.5 ${i % 2 === 0 ? 'w-36' : 'w-28'}`} />
              <SkeletonBlock className="h-3 w-48" />
            </div>
            <SkeletonBadge />
          </div>
        ))}
      </div>
    </div>
  );
}
