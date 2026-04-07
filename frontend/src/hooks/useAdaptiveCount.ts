import { useEffect, useMemo, useState } from 'react';
import {
    computeAdaptiveSkeletonGridItems,
    computeAdaptiveSkeletonRows,
    type AdaptiveSkeletonGridOptions,
    type AdaptiveSkeletonRowsOptions,
} from '../components/ui/Skeleton';

interface AdaptiveCountViewportOptions {
    viewportOffset?: number;
    fallbackHeight?: number;
}

interface UseAdaptiveRowsOptions extends AdaptiveSkeletonRowsOptions, AdaptiveCountViewportOptions {}

interface UseAdaptiveGridCountOptions extends AdaptiveSkeletonGridOptions, AdaptiveCountViewportOptions {}

const resolveViewportHeight = (viewportOffset = 320, fallbackHeight = 360) => {
    if (typeof window === 'undefined') {
        return fallbackHeight;
    }
    return Math.max(fallbackHeight, window.innerHeight - viewportOffset);
};

export const useAdaptiveRows = (options: UseAdaptiveRowsOptions = {}) => {
    const {
        viewportOffset = 320,
        fallbackHeight = 360,
        containerMaxHeight,
        ...rest
    } = options;

    const buildCount = () => computeAdaptiveSkeletonRows({
        ...rest,
        containerMaxHeight: containerMaxHeight ?? resolveViewportHeight(viewportOffset, fallbackHeight),
    });

    const [count, setCount] = useState<number>(buildCount);

    useEffect(() => {
        const sync = () => setCount(buildCount());
        sync();
        if (typeof window === 'undefined') return;
        window.addEventListener('resize', sync);
        return () => window.removeEventListener('resize', sync);
    }, [
        viewportOffset,
        fallbackHeight,
        containerMaxHeight,
        rest.rowHeight,
        rest.minRows,
        rest.maxRows,
        rest.expectedCount,
        rest.density,
    ]);

    return count;
};

export const useAdaptiveGridCount = (options: UseAdaptiveGridCountOptions = {}) => {
    const {
        viewportOffset = 320,
        fallbackHeight = 360,
        containerMaxHeight,
        ...rest
    } = options;

    const computeCount = useMemo(() => {
        return () => computeAdaptiveSkeletonGridItems({
            ...rest,
            containerMaxHeight: containerMaxHeight ?? resolveViewportHeight(viewportOffset, fallbackHeight),
        });
    }, [
        viewportOffset,
        fallbackHeight,
        containerMaxHeight,
        rest.columns,
        rest.rowHeight,
        rest.minRows,
        rest.maxRows,
        rest.expectedCount,
        rest.density,
    ]);

    const [count, setCount] = useState<number>(() => computeCount());

    useEffect(() => {
        const sync = () => setCount(computeCount());
        sync();
        if (typeof window === 'undefined') return;
        window.addEventListener('resize', sync);
        return () => window.removeEventListener('resize', sync);
    }, [computeCount]);

    return count;
};
