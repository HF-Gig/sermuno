import React from 'react';
import { SkeletonBlock, SkeletonButton } from '../ui/Skeleton';

export function ExportSkeleton() {
  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <SkeletonBlock className="h-6 w-40 animate-pulse" />
      {/* Format selector */}
      <div className="animate-pulse space-y-2">
        <SkeletonBlock className="h-3.5 w-20" />
        <div className="grid grid-cols-4 gap-2">
          {[1,2,3,4].map(i => <SkeletonBlock key={i} className="h-16 rounded-lg" />)}
        </div>
      </div>
      {/* Scope selector */}
      <div className="animate-pulse space-y-2">
        <SkeletonBlock className="h-3.5 w-24" />
        <SkeletonBlock className="h-9 w-full rounded-lg" />
      </div>
      <SkeletonButton className="w-32 animate-pulse" />
      {/* History */}
      <div className="animate-pulse space-y-3 pt-4 border-t border-gray-200 dark:border-gray-700">
        <SkeletonBlock className="h-4 w-32" />
        {[1,2].map(i => (
          <div key={i} className="flex items-center gap-3 p-3 rounded border border-gray-100 dark:border-gray-800">
            <SkeletonBlock className="h-4 flex-1" />
            <SkeletonBlock className="h-4 w-16" />
            <SkeletonBlock className="h-7 w-20 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
