import React from 'react';
import { SkeletonBlock, SkeletonBadge } from '../ui/Skeleton';
import { useAdaptiveRows } from '../../hooks/useAdaptiveCount';

export function ThreadDetailSkeleton() {
  const messageRows = useAdaptiveRows({
    rowHeight: 92,
    minRows: 3,
    maxRows: 7,
    viewportOffset: 300,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="animate-pulse px-5 py-4 border-b border-gray-100 dark:border-gray-800 space-y-2">
        <SkeletonBlock className="h-5 w-3/4" />
        <div className="flex gap-2">
          <SkeletonBadge />
          <SkeletonBadge />
        </div>
      </div>
      {/* Messages */}
      <div className="flex-1 p-5 space-y-5 overflow-hidden">
        {Array.from({ length: messageRows }, (_, i) => (
          <div key={i} className="animate-pulse space-y-2">
            <div className="flex items-center gap-2">
              <SkeletonBlock className="h-7 w-7 rounded-full" />
              <SkeletonBlock className="h-3.5 w-32" />
              <SkeletonBlock className="h-3 w-20 ml-auto" />
            </div>
            <div className="ml-9 space-y-1.5">
              <SkeletonBlock className="h-3.5 w-full" />
              <SkeletonBlock className="h-3.5 w-5/6" />
              {i === 1 && <SkeletonBlock className="h-3.5 w-4/6" />}
            </div>
          </div>
        ))}
      </div>
      {/* Reply bar placeholder */}
      <div className="animate-pulse px-4 py-3 border-t border-gray-100 dark:border-gray-800">
        <SkeletonBlock className="h-9 w-full rounded-lg" />
      </div>
    </div>
  );
}
