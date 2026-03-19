import React from 'react';
import { SkeletonBlock } from '../ui/Skeleton';

export function CalendarSkeleton() {
  return (
    <div className="p-4 space-y-3">
      {/* Header: month nav + view toggle */}
      <div className="animate-pulse flex items-center justify-between mb-4">
        <SkeletonBlock className="h-6 w-36" />
        <div className="flex gap-2">
          <SkeletonBlock className="h-8 w-8 rounded" />
          <SkeletonBlock className="h-8 w-20 rounded" />
          <SkeletonBlock className="h-8 w-8 rounded" />
        </div>
      </div>
      {/* Day names row */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <SkeletonBlock key={i} className="h-4 w-full rounded" />
        ))}
      </div>
      {/* Calendar cells — 5 weeks */}
      {Array.from({ length: 5 }).map((_, week) => (
        <div key={week} className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, day) => (
            <div key={day} className="animate-pulse space-y-1 rounded p-1 min-h-[80px]">
              <SkeletonBlock className="h-4 w-6 rounded" />
              {/* Random event blocks */}
              {(week * 7 + day) % 3 === 0 && (
                <SkeletonBlock className="h-5 w-full rounded" />
              )}
              {(week * 7 + day) % 5 === 0 && (
                <SkeletonBlock className="h-5 w-3/4 rounded" />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
