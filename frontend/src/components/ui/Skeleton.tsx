import React from 'react';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export type SkeletonDensity = 'compact' | 'comfortable';

export interface AdaptiveSkeletonRowsOptions {
  rowHeight?: number;
  containerMaxHeight?: number;
  minRows?: number;
  maxRows?: number;
  expectedCount?: number;
  density?: SkeletonDensity;
}

export interface AdaptiveSkeletonGridOptions extends AdaptiveSkeletonRowsOptions {
  columns?: number;
}

const DENSITY_ROW_HEIGHT: Record<SkeletonDensity, number> = {
  compact: 44,
  comfortable: 56,
};

const DEFAULT_WIDTH_PATTERN = ['w-full', 'w-11/12', 'w-10/12', 'w-9/12', 'w-4/5'];

const clamp = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
};

export const skeletonWidthFromPattern = (
  index: number,
  pattern: string[] = DEFAULT_WIDTH_PATTERN,
) => {
  if (!Array.isArray(pattern) || pattern.length === 0) {
    return 'w-full';
  }
  return pattern[index % pattern.length] || 'w-full';
};

export const computeAdaptiveSkeletonRows = (options: AdaptiveSkeletonRowsOptions = {}) => {
  const density = options.density ?? 'comfortable';
  const minRows = Math.max(1, options.minRows ?? 3);
  const maxRows = Math.max(minRows, options.maxRows ?? 12);
  const rowHeight = Math.max(1, options.rowHeight ?? DENSITY_ROW_HEIGHT[density]);
  const expectedCount = Math.max(0, Math.floor(options.expectedCount ?? 0));
  const containerBasedRows = options.containerMaxHeight
    ? Math.floor(options.containerMaxHeight / rowHeight)
    : minRows;

  const preferredRows = expectedCount > 0 ? expectedCount : containerBasedRows;
  return clamp(preferredRows, minRows, maxRows);
};

export const computeAdaptiveSkeletonGridItems = (options: AdaptiveSkeletonGridOptions = {}) => {
  const columns = Math.max(1, options.columns ?? 1);
  const rows = computeAdaptiveSkeletonRows(options);
  return rows * columns;
};

export function InlineSkeleton({ className = '', ...props }: SkeletonProps) {
  return <span className={`inline-block animate-pulse rounded bg-slate-50 ${className}`} {...props} />;
}

// Base shimmer block
export function SkeletonBlock({ className = '', ...props }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse bg-slate-100 rounded ${className}`}
      {...props}
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
    <div className={`animate-pulse rounded-lg border border-slate-100 p-4 space-y-3 ${className}`}>
      <SkeletonBlock className="h-4 w-1/2" />
      <SkeletonBlock className="h-8 w-3/4" />
      <SkeletonBlock className="h-3 w-full" />
    </div>
  );
}

interface AdaptiveListSkeletonProps extends AdaptiveSkeletonRowsOptions {
  rows?: number;
  className?: string;
  gapClassName?: string;
  renderRow?: (index: number) => React.ReactNode;
}

export function AdaptiveListSkeleton({
  rows,
  className = '',
  gapClassName = 'space-y-2',
  renderRow,
  ...options
}: AdaptiveListSkeletonProps) {
  const resolvedRows = rows && rows > 0 ? rows : computeAdaptiveSkeletonRows(options);

  return (
    <div className={`${gapClassName} ${className}`.trim()}>
      {Array.from({ length: resolvedRows }, (_, index) => (
        <React.Fragment key={index}>
          {renderRow ? (
            renderRow(index)
          ) : (
            <SkeletonBlock className={`h-4 rounded ${skeletonWidthFromPattern(index)}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

interface AdaptiveCardGridSkeletonProps extends AdaptiveSkeletonGridOptions {
  className?: string;
  cardClassName?: string;
  renderCard?: (index: number) => React.ReactNode;
}

export function AdaptiveCardGridSkeleton({
  columns = 1,
  className = '',
  cardClassName = 'rounded-xl border border-[var(--color-card-border)] bg-white p-4',
  renderCard,
  ...options
}: AdaptiveCardGridSkeletonProps) {
  const itemCount = computeAdaptiveSkeletonGridItems({ ...options, columns });

  return (
    <div className={`${className}`.trim()}>
      {Array.from({ length: itemCount }, (_, index) => (
        <React.Fragment key={index}>
          {renderCard ? (
            renderCard(index)
          ) : (
            <div className={`animate-pulse ${cardClassName}`}>
              <SkeletonBlock className={`h-4 rounded ${skeletonWidthFromPattern(index, ['w-1/2', 'w-2/3', 'w-3/5'])}`} />
              <SkeletonBlock className={`mt-3 h-3 rounded ${skeletonWidthFromPattern(index, ['w-full', 'w-11/12', 'w-4/5'])}`} />
              <SkeletonBlock className={`mt-2 h-3 rounded ${skeletonWidthFromPattern(index, ['w-4/5', 'w-3/4', 'w-2/3'])}`} />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

interface AdaptiveTableRowsSkeletonProps extends AdaptiveSkeletonRowsOptions {
  cols: number;
  className?: string;
  rowClassName?: string;
}

export function AdaptiveTableRowsSkeleton({
  cols,
  className = '',
  rowClassName = 'border-t border-[var(--color-card-border)]',
  ...options
}: AdaptiveTableRowsSkeletonProps) {
  const resolvedRows = computeAdaptiveSkeletonRows(options);

  return (
    <React.Fragment>
      {Array.from({ length: resolvedRows }, (_, rowIndex) => (
        <tr key={rowIndex} className={`${rowClassName} animate-pulse ${className}`.trim()}>
          {Array.from({ length: cols }, (_, colIndex) => (
            <td key={colIndex} className="px-4 py-3">
              <InlineSkeleton
                className={`h-4 ${colIndex === 0 ? skeletonWidthFromPattern(rowIndex, ['w-32', 'w-36', 'w-28']) : skeletonWidthFromPattern(rowIndex + colIndex, ['w-16', 'w-20', 'w-24', 'w-28'])}`}
              />
            </td>
          ))}
        </tr>
      ))}
    </React.Fragment>
  );
}

interface PersonRowSkeletonProps {
  index: number;
  density?: SkeletonDensity;
  className?: string;
}

export function PersonRowSkeleton({
  index,
  density = 'comfortable',
  className = '',
}: PersonRowSkeletonProps) {
  const avatarSize = density === 'compact' ? 'h-7 w-7' : 'h-8 w-8';
  const titleHeight = density === 'compact' ? 'h-2.5' : 'h-3';
  const subtitleHeight = density === 'compact' ? 'h-2' : 'h-2.5';
  const rowPadding = density === 'compact' ? 'py-1.5' : 'py-2';

  return (
    <div className={`flex items-center gap-3 ${rowPadding} ${className}`.trim()}>
      <SkeletonBlock className={`${avatarSize} shrink-0 rounded-full bg-slate-100/80`} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <SkeletonBlock
          className={`${titleHeight} rounded bg-slate-100/80 ${skeletonWidthFromPattern(index, ['w-3/5', 'w-2/3', 'w-1/2'])}`}
        />
        <SkeletonBlock
          className={`${subtitleHeight} rounded bg-slate-100/80 ${skeletonWidthFromPattern(index, ['w-4/5', 'w-2/3', 'w-3/4'])}`}
        />
      </div>
    </div>
  );
}
