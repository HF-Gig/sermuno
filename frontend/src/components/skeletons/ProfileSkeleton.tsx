import React from 'react';
import { SkeletonBlock, SkeletonAvatar, SkeletonButton } from '../ui/Skeleton';
import { useAdaptiveRows } from '../../hooks/useAdaptiveCount';

export function ProfileSkeleton() {
  const fieldRows = useAdaptiveRows({
    rowHeight: 66,
    minRows: 4,
    maxRows: 7,
    viewportOffset: 380,
  });

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Avatar + name header */}
      <div className="animate-pulse flex items-center gap-4">
        <SkeletonAvatar className="h-16 w-16" />
        <div className="space-y-2">
          <SkeletonBlock className="h-5 w-36" />
          <SkeletonBlock className="h-3.5 w-48" />
        </div>
      </div>
      {/* Form fields */}
      {Array.from({ length: fieldRows }, (_, i) => (
        <div key={i} className="animate-pulse space-y-1.5">
          <SkeletonBlock className="h-3.5 w-28" />
          <SkeletonBlock className="h-9 w-full rounded-lg" />
        </div>
      ))}
      <SkeletonButton className="w-28" />
    </div>
  );
}
