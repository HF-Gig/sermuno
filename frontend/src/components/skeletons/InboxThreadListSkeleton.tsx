import React from 'react';
import {
  SkeletonBlock,
  SkeletonBadge,
  computeAdaptiveSkeletonRows,
  skeletonWidthFromPattern,
  type SkeletonDensity,
} from '../ui/Skeleton';

interface InboxThreadListSkeletonProps {
  rows?: number;
  rowHeight?: number;
  containerMaxHeight?: number;
  expectedCount?: number;
  minRows?: number;
  maxRows?: number;
  density?: SkeletonDensity;
}

const THREAD_ROW_HEIGHT_BY_DENSITY: Record<SkeletonDensity, number> = {
  compact: 62,
  comfortable: 76,
};

export function InboxThreadListSkeleton({
  rows,
  rowHeight,
  containerMaxHeight = 980,
  expectedCount,
  minRows = 8,
  maxRows = 18,
  density = 'comfortable',
}: InboxThreadListSkeletonProps) {
  const resolvedRows = rows && rows > 0
    ? rows
    : computeAdaptiveSkeletonRows({
      rowHeight: rowHeight ?? THREAD_ROW_HEIGHT_BY_DENSITY[density],
      containerMaxHeight,
      expectedCount,
      minRows,
      maxRows,
      density,
    });

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {Array.from({ length: resolvedRows }).map((_, i) => (
        <div key={i} className="animate-pulse flex items-start gap-3 px-4 py-3">
          <SkeletonBlock className="h-8 w-8 rounded-full shrink-0 mt-1" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <SkeletonBlock className={`h-3.5 ${skeletonWidthFromPattern(i, ['w-32', 'w-24', 'w-28'])}`} />
              <SkeletonBlock className="h-3 w-12 shrink-0" />
            </div>
            <SkeletonBlock className={`h-3.5 ${skeletonWidthFromPattern(i, ['w-4/5', 'w-3/5', 'w-2/3'])}`} />
            <SkeletonBlock className={`h-3 opacity-60 ${skeletonWidthFromPattern(i, ['w-full', 'w-4/5', 'w-11/12'])}`} />
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
