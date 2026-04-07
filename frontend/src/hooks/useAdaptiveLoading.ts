import { useEffect, useRef, useState } from 'react';

interface AdaptiveLoadingOptions {
    showDelayMs?: number;
    minVisibleMs?: number;
}

/**
 * Smooth loading visibility to avoid skeleton flash for quick responses.
 */
export const useAdaptiveLoading = (
    loading: boolean,
    options: AdaptiveLoadingOptions = {},
) => {
    const showDelayMs = options.showDelayMs ?? 120;
    const minVisibleMs = options.minVisibleMs ?? 180;

    const [visible, setVisible] = useState(false);
    const showTimerRef = useRef<number | null>(null);
    const hideTimerRef = useRef<number | null>(null);
    const visibleSinceRef = useRef<number | null>(null);

    useEffect(() => {
        if (showTimerRef.current !== null) {
            window.clearTimeout(showTimerRef.current);
            showTimerRef.current = null;
        }

        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }

        if (loading) {
            if (visible) {
                return;
            }

            showTimerRef.current = window.setTimeout(() => {
                visibleSinceRef.current = Date.now();
                setVisible(true);
                showTimerRef.current = null;
            }, Math.max(0, showDelayMs));

            return;
        }

        if (!visible) {
            return;
        }

        const visibleSince = visibleSinceRef.current;
        const elapsed = visibleSince ? Date.now() - visibleSince : minVisibleMs;
        const remaining = Math.max(0, minVisibleMs - elapsed);

        hideTimerRef.current = window.setTimeout(() => {
            visibleSinceRef.current = null;
            setVisible(false);
            hideTimerRef.current = null;
        }, remaining);
    }, [loading, minVisibleMs, showDelayMs, visible]);

    useEffect(() => () => {
        if (showTimerRef.current !== null) {
            window.clearTimeout(showTimerRef.current);
        }
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
        }
    }, []);

    return visible;
};
