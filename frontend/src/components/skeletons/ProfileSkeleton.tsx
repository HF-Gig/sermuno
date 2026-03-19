import React from 'react';
import { SkeletonBlock, SkeletonAvatar, SkeletonButton } from '../ui/Skeleton';

export function ProfileSkeleton() {
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
      {[1,2,3,4].map(i => (
        <div key={i} className="animate-pulse space-y-1.5">
          <SkeletonBlock className="h-3.5 w-28" />
          <SkeletonBlock className="h-9 w-full rounded-lg" />
        </div>
      ))}
      <SkeletonButton className="w-28" />
    </div>
  );
}
