import React from 'react';
import { SkeletonBlock, SkeletonAvatar, SkeletonBadge } from '../ui/Skeleton';

export function ContactsSkeleton() {
  return (
    <div className="p-6 space-y-4">
      {/* Search + filter row */}
      <div className="animate-pulse flex gap-3">
        <SkeletonBlock className="h-9 flex-1 rounded-lg" />
        <SkeletonBlock className="h-9 w-28 rounded-lg" />
      </div>
      {/* Contact rows */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="animate-pulse flex items-center gap-3 p-3 rounded-lg border border-gray-100 dark:border-gray-800">
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
