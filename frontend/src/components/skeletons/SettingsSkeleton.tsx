import React from 'react';
import { SkeletonBlock, SkeletonButton, skeletonWidthFromPattern } from '../ui/Skeleton';
import { useAdaptiveRows } from '../../hooks/useAdaptiveCount';

export function SettingsSkeleton() {
  const fieldRows = useAdaptiveRows({
    rowHeight: 68,
    minRows: 3,
    maxRows: 7,
    viewportOffset: 360,
  });

  return (
    <div className="p-6 space-y-6">
      {/* Tab bar */}
      <div className="animate-pulse flex gap-1 border-b border-slate-200 pb-0">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonBlock key={i} className={`h-9 rounded-t ${skeletonWidthFromPattern(i, ['w-20', 'w-24', 'w-28', 'w-16'])}`} />
        ))}
      </div>
      {/* Content: form fields */}
      <div className="animate-pulse max-w-lg space-y-5">
        {Array.from({ length: fieldRows }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <SkeletonBlock className="h-3.5 w-24" />
            <SkeletonBlock className="h-9 w-full rounded-lg" />
          </div>
        ))}
        <SkeletonButton className="w-24 mt-2" />
      </div>
    </div>
  );
}
