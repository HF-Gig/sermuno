import React from 'react';
import { SkeletonBlock, SkeletonBadge } from '../ui/Skeleton';

export function InboxThreadListSkeleton() {
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {Array.from({ length: 15 }).map((_, i) => (
        <div key={i} className="animate-pulse flex items-start gap-3 px-4 py-3">
          <SkeletonBlock className="h-8 w-8 rounded-full shrink-0 mt-1" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <SkeletonBlock className={`h-3.5 ${i % 3 === 0 ? 'w-32' : i % 3 === 1 ? 'w-24' : 'w-28'}`} />
              <SkeletonBlock className="h-3 w-12 shrink-0" />
            </div>
            <SkeletonBlock className={`h-3.5 ${i % 2 === 0 ? 'w-4/5' : 'w-3/5'}`} />
            <SkeletonBlock className={`h-3 ${i % 2 === 0 ? 'w-full' : 'w-4/5'} opacity-60`} />
            <div className="flex gap-1.5 mt-1">
              {i % 4 === 0 && <SkeletonBadge />}
              {i % 3 === 0 && <SkeletonBadge />}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
