import React from 'react';
import {
  SkeletonBlock,
  SkeletonBadge,
  SkeletonButton,
  computeAdaptiveSkeletonRows,
  skeletonWidthFromPattern,
  type SkeletonDensity,
} from '../ui/Skeleton';

interface TablePageSkeletonProps {
  rows?: number;
  cols?: number;
  showHeader?: boolean;
  rowHeight?: number;
  containerMaxHeight?: number;
  expectedCount?: number;
  minRows?: number;
  maxRows?: number;
  density?: SkeletonDensity;
}

const TABLE_ROW_HEIGHT_BY_DENSITY: Record<SkeletonDensity, number> = {
  compact: 44,
  comfortable: 56,
};

export function TablePageSkeleton({
  rows,
  cols = 4,
  showHeader = true,
  rowHeight,
  containerMaxHeight = 360,
  expectedCount,
  minRows = 4,
  maxRows = 10,
  density = 'comfortable',
}: TablePageSkeletonProps) {
  const resolvedRows = rows && rows > 0
    ? rows
    : computeAdaptiveSkeletonRows({
      rowHeight: rowHeight ?? TABLE_ROW_HEIGHT_BY_DENSITY[density],
      containerMaxHeight,
      expectedCount,
      minRows,
      maxRows,
      density,
    });

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
            <SkeletonBlock
              key={i}
              className={`h-3.5 ${i === 0 ? 'flex-1' : skeletonWidthFromPattern(i, ['w-16', 'w-20', 'w-24'])}`}
            />
          ))}
        </div>
        {/* Rows */}
        {Array.from({ length: resolvedRows }).map((_, i) => (
          <div key={i} className="animate-pulse flex gap-4 px-4 py-3.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
            {Array.from({ length: cols }).map((_, j) => (
              <SkeletonBlock
                key={j}
                className={`h-3.5 ${j === 0 ? 'flex-1' : j === cols - 1 ? 'w-16' : skeletonWidthFromPattern(i + j, ['w-16', 'w-20', 'w-24'])} ${j === 0 ? skeletonWidthFromPattern(i, ['w-4/5', 'w-3/4', 'w-11/12']) : ''}`}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
