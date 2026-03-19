import React from 'react';
import { SkeletonBlock, SkeletonButton } from '../ui/Skeleton';

export function SettingsSkeleton() {
  return (
    <div className="p-6 space-y-6">
      {/* Tab bar */}
      <div className="animate-pulse flex gap-1 border-b border-gray-200 dark:border-gray-700 pb-0">
        {[24, 20, 22, 18, 28, 20].map((w, i) => (
          <SkeletonBlock key={i} className={`h-9 w-${w} rounded-t`} />
        ))}
      </div>
      {/* Content: form fields */}
      <div className="animate-pulse max-w-lg space-y-5">
        {[1,2,3].map(i => (
          <div key={i} className="space-y-1.5">
            <SkeletonBlock className="h-3.5 w-24" />
            <SkeletonBlock className="h-9 w-full rounded-lg" />
          </div>
        ))}
        <SkeletonButton className="w-24 mt-2" />
      </div>
    </div>
  );
}
