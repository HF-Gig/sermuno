import React from 'react';
import { SkeletonBlock } from '../ui/Skeleton';

export function AnalyticsSkeleton() {
  return (
    <div className="p-6 space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => (
          <div key={i} className="animate-pulse rounded-lg border border-slate-200 p-4 space-y-2">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="h-9 w-14" />
          </div>
        ))}
      </div>
      {/* Two chart panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[1,2].map(i => (
          <div key={i} className="animate-pulse rounded-lg border border-slate-200 p-4">
            <SkeletonBlock className="h-4 w-32 mb-4" />
            <SkeletonBlock className="h-44 w-full rounded" />
          </div>
        ))}
      </div>
      {/* Table */}
      <div className="animate-pulse rounded-lg border border-slate-200 p-4">
        <SkeletonBlock className="h-4 w-28 mb-4" />
        {[1,2,3,4,5].map(i => (
          <div key={i} className="flex gap-4 py-2 border-t border-slate-100">
            <SkeletonBlock className="h-3.5 flex-1" />
            <SkeletonBlock className="h-3.5 w-16" />
            <SkeletonBlock className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
