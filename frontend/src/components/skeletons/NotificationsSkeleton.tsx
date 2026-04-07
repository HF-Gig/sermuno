import React from 'react';
import { SkeletonBlock, SkeletonAvatar, SkeletonBadge } from '../ui/Skeleton';
import { useAdaptiveRows } from '../../hooks/useAdaptiveCount';

export function NotificationsSkeleton() {
  const rowCount = useAdaptiveRows({
    rowHeight: 78,
    minRows: 4,
    maxRows: 10,
    viewportOffset: 300,
  });

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {Array.from({ length: rowCount }, (_, i) => (
        <div key={i} className="animate-pulse flex items-start gap-3 px-4 py-3">
          <SkeletonAvatar className="h-8 w-8 mt-0.5" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center justify-between">
              <SkeletonBlock className={`h-3.5 ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'}`} />
              <SkeletonBlock className="h-3 w-14 shrink-0" />
            </div>
            <SkeletonBlock className={`h-3 ${i % 3 === 0 ? 'w-full' : 'w-4/5'}`} />
          </div>
          {i % 3 !== 0 && <SkeletonBlock className="h-2 w-2 rounded-full shrink-0 mt-2" />}
        </div>
      ))}
    </div>
  );
}
