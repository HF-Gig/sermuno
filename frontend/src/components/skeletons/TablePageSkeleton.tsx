import React from 'react';
import { SkeletonBlock, SkeletonBadge, SkeletonButton } from '../ui/Skeleton';

interface TablePageSkeletonProps {
  rows?: number;
  cols?: number;
  showHeader?: boolean;
}

export function TablePageSkeleton({ rows = 6, cols = 4, showHeader = true }: TablePageSkeletonProps) {
  return (
    <div className="p-6 space-y-4">
      {showHeader && (
        <div className="animate-pulse flex items-center justify-between">
          <SkeletonBlock className="h-6 w-40" />
          <SkeletonButton className="w-32" />
        </div>
      )}
      {/* Filter/search bar */}
      <div className="animate-pulse flex gap-3">
        <SkeletonBlock className="h-9 flex-1 max-w-sm rounded-lg" />
        <SkeletonBadge className="h-9 w-20" />
      </div>
      {/* Table */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Table header */}
        <div className="animate-pulse flex gap-4 px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          {Array.from({ length: cols }).map((_, i) => (
            <SkeletonBlock key={i} className={`h-3.5 ${i === 0 ? 'flex-1' : 'w-20'}`} />
          ))}
        </div>
        {/* Rows */}
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="animate-pulse flex gap-4 px-4 py-3.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
            {Array.from({ length: cols }).map((_, j) => (
              <SkeletonBlock
                key={j}
                className={`h-3.5 ${j === 0 ? 'flex-1' : j === cols - 1 ? 'w-16' : 'w-20'} ${i % 3 === 0 && j === 0 ? 'w-3/4' : ''}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
