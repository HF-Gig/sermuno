import React from 'react';
import { SkeletonBlock, SkeletonBadge, SkeletonButton } from '../ui/Skeleton';

export function BillingSkeleton() {
  return (
    <div className="p-6 space-y-6">
      {/* Current plan card */}
      <div className="animate-pulse rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-3">
        <div className="flex items-center justify-between">
          <SkeletonBlock className="h-5 w-32" />
          <SkeletonBadge />
        </div>
        <SkeletonBlock className="h-8 w-24" />
        <SkeletonBlock className="h-3.5 w-3/4" />
        <SkeletonButton className="w-36" />
      </div>
      {/* Usage stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[1,2,3].map(i => (
          <div key={i} className="animate-pulse rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-2">
            <SkeletonBlock className="h-3.5 w-20" />
            <SkeletonBlock className="h-6 w-16" />
            <SkeletonBlock className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
