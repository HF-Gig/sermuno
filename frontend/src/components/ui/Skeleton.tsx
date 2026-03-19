import React from 'react';

interface SkeletonProps {
  className?: string;
}

export function InlineSkeleton({ className = '' }: SkeletonProps) {
  return <span className={`inline-block animate-pulse rounded bg-[var(--color-background)] ${className}`} />;
}

// Base shimmer block
export function SkeletonBlock({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className}`}
    />
  );
}

// Text line — varies width to look natural
export function SkeletonText({ className = '' }: SkeletonProps) {
  return <SkeletonBlock className={`h-4 rounded ${className}`} />;
}

// Avatar circle
export function SkeletonAvatar({ className = '' }: SkeletonProps) {
  return <SkeletonBlock className={`rounded-full ${className}`} />;
}

// Badge / pill
export function SkeletonBadge({ className = '' }: SkeletonProps) {
  return <SkeletonBlock className={`h-5 w-16 rounded-full ${className}`} />;
}

// Full-width button
export function SkeletonButton({ className = '' }: SkeletonProps) {
  return <SkeletonBlock className={`h-9 rounded-lg ${className}`} />;
}

// Table row
export function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <SkeletonBlock className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

// Card
export function SkeletonCard({ className = '' }: SkeletonProps) {
  return (
    <div className={`animate-pulse rounded-lg border border-gray-200 dark:border-gray-700 p-4 space-y-3 ${className}`}>
      <SkeletonBlock className="h-4 w-1/2" />
      <SkeletonBlock className="h-8 w-3/4" />
      <SkeletonBlock className="h-3 w-full" />
    </div>
  );
}
