import React from 'react';
import { useAdaptiveRows } from '../../hooks/useAdaptiveCount';

export function DashboardSkeleton() {
  const statsCards = useAdaptiveRows({
    rowHeight: 180,
    minRows: 1,
    maxRows: 1,
    expectedCount: 1,
    viewportOffset: 520,
  }) * 4;
  const tableRows = useAdaptiveRows({
    rowHeight: 34,
    minRows: 3,
    maxRows: 7,
    viewportOffset: 420,
  });
  const activityRows = useAdaptiveRows({
    rowHeight: 52,
    minRows: 4,
    maxRows: 8,
    viewportOffset: 360,
  });
  const chartBars = useAdaptiveRows({
    rowHeight: 14,
    minRows: 18,
    maxRows: 32,
    viewportOffset: 420,
  });

  return (
    <div className="space-y-5">
      {/* Row 1: four stat cards */}
      <div className="grid grid-cols-1 min-[426px]:grid-cols-2 min-[787px]:grid-cols-4 gap-4">
        {Array.from({ length: statsCards }, (_, card) => (
          <div key={card} className="rounded-xl border border-[var(--color-card-border)] bg-white px-5 py-4 shadow-[var(--shadow-sm)]">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-5 h-5 rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />
              <div className="h-3 w-28 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            </div>
            <div className="h-8 w-14 rounded bg-gray-200 dark:bg-gray-700 animate-pulse mb-2" />
            <div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          </div>
        ))}
      </div>

      {/* Row 2: threads + activity */}
      <div className="grid grid-cols-1 gap-4 min-[787px]:grid-cols-[minmax(0,1fr)_360px] min-[1440px]:grid-cols-[minmax(0,1fr)_390px]">
        <div className="rounded-xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-card-border)] flex items-center justify-between">
            <div className="h-4 w-36 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
            <div className="h-3 w-12 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          </div>

          <div className="h-[308px] px-5 py-3">
            <div className="grid grid-cols-5 gap-3 mb-3">
              {[1, 2, 3, 4, 5].map((h) => (
                <div key={h} className="h-3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
              ))}
            </div>

            <div className="space-y-4">
              {Array.from({ length: tableRows }, (_, r) => (
                <div key={r} className="grid grid-cols-5 gap-3 items-center">
                  <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                  <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                  <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                  <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                  <div className="h-3 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] px-4 py-3">
          <div className="h-4 w-28 rounded bg-gray-200 dark:bg-gray-700 animate-pulse mb-4" />
          <div className="space-y-4">
            {Array.from({ length: activityRows }, (_, row) => (
              <div key={row} className="flex items-start gap-2.5">
                <div className="w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse mt-0.5" />
                <div className="flex-1">
                  <div className="h-3 w-[85%] rounded bg-gray-200 dark:bg-gray-700 animate-pulse mb-1.5" />
                  <div className="h-3 w-[45%] rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3: SLA & Performance */}
      <div className="rounded-xl border border-[var(--color-card-border)] bg-white shadow-[var(--shadow-sm)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--color-card-border)] flex items-center justify-between">
          <div className="h-4 w-36 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div className="flex gap-1">
            {Array.from({ length: 3 }, (_, pill) => (
              <div key={pill} className="h-5 w-10 rounded-md bg-gray-200 dark:bg-gray-700 animate-pulse" />
            ))}
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center gap-6 mb-4">
            {Array.from({ length: 3 }, (_, group) => (
              <div key={group} className="flex items-end gap-2">
                <div className="h-6 w-10 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
                <div className="h-3 w-16 rounded bg-gray-200 dark:bg-gray-700 animate-pulse mb-0.5" />
              </div>
            ))}
          </div>

          <div className="h-[220px] flex items-end gap-2 px-1">
            {Array.from({ length: chartBars }, (_, idx) => {
              const height = 22 + ((idx * 11) % 56);
              return (
              <div
                key={idx}
                className="flex-1 rounded-t bg-gray-200 dark:bg-gray-700 animate-pulse"
                style={{ height: `${height}%` }}
              />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
