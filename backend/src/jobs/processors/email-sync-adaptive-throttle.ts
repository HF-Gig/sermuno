import * as v8 from 'v8';

export interface EmailSyncAdaptiveThrottleOptions {
  enableBackpressure: boolean;
  enableSmartBackoff: boolean;
  backpressure: {
    highWatermark: number;
    recoveryWatermark: number;
    minDelayMs: number;
    maxDelayMs: number;
  };
  smartBackoff: {
    baseDelayMs: number;
    maxDelayMs: number;
    windowSize: number;
    errorRateWeight: number;
    consecutiveWeight: number;
  };
}

export interface EmailSyncAdaptiveDelay {
  backpressureDelayMs: number;
  smartBackoffDelayMs: number;
  totalDelayMs: number;
  heapRatio: number;
}

interface SmartBackoffState {
  outcomes: boolean[];
  consecutiveFailures: number;
}

export class EmailSyncAdaptiveThrottle {
  private readonly smartBackoffState = new Map<string, SmartBackoffState>();
  private backpressureActive = false;

  constructor(
    private readonly memoryUsageReader: () => NodeJS.MemoryUsage = () =>
      process.memoryUsage(),
    private readonly heapLimitReader: () => number = () =>
      v8.getHeapStatistics().heap_size_limit,
  ) {}

  computeDelay(
    bucketKey: string,
    options: EmailSyncAdaptiveThrottleOptions,
  ): EmailSyncAdaptiveDelay {
    const heapRatio = this.heapRatio();
    const backpressureDelayMs = this.backpressureDelayMs(options, heapRatio);
    const smartBackoffDelayMs = this.smartBackoffDelayMs(bucketKey, options);

    return {
      backpressureDelayMs,
      smartBackoffDelayMs,
      totalDelayMs: Math.max(backpressureDelayMs, smartBackoffDelayMs),
      heapRatio,
    };
  }

  recordSuccess(
    bucketKey: string,
    options: EmailSyncAdaptiveThrottleOptions,
  ): void {
    if (!options.enableSmartBackoff) return;
    const state = this.ensureSmartBackoffState(bucketKey);
    state.consecutiveFailures = 0;
    state.outcomes.push(true);
    this.trimOutcomes(state, options.smartBackoff.windowSize);
  }

  recordFailure(
    bucketKey: string,
    options: EmailSyncAdaptiveThrottleOptions,
  ): void {
    if (!options.enableSmartBackoff) return;
    const state = this.ensureSmartBackoffState(bucketKey);
    state.consecutiveFailures += 1;
    state.outcomes.push(false);
    this.trimOutcomes(state, options.smartBackoff.windowSize);
  }

  private smartBackoffDelayMs(
    bucketKey: string,
    options: EmailSyncAdaptiveThrottleOptions,
  ): number {
    if (!options.enableSmartBackoff) return 0;
    const state = this.smartBackoffState.get(bucketKey);
    if (!state || state.outcomes.length === 0) return 0;

    const sampleCount = state.outcomes.length;
    const failureCount = state.outcomes.filter((outcome) => !outcome).length;
    const errorRate = failureCount / sampleCount;

    const score =
      errorRate * Math.max(0, options.smartBackoff.errorRateWeight) +
      state.consecutiveFailures * Math.max(0, options.smartBackoff.consecutiveWeight);

    if (score <= 0) return 0;

    const baseDelayMs = Math.max(1, Math.round(options.smartBackoff.baseDelayMs));
    const maxDelayMs = Math.max(baseDelayMs, options.smartBackoff.maxDelayMs);
    const delayMs = Math.round(baseDelayMs * (Math.pow(2, score) - 1));

    return Math.max(0, Math.min(maxDelayMs, delayMs));
  }

  private backpressureDelayMs(
    options: EmailSyncAdaptiveThrottleOptions,
    heapRatio: number,
  ): number {
    if (!options.enableBackpressure) return 0;

    const highWatermark = this.clamp(options.backpressure.highWatermark, 0.1, 0.99);
    const recoveryWatermark = this.clamp(
      options.backpressure.recoveryWatermark,
      0.05,
      highWatermark - 0.01,
    );
    const minDelayMs = Math.max(0, Math.round(options.backpressure.minDelayMs));
    const maxDelayMs = Math.max(minDelayMs, Math.round(options.backpressure.maxDelayMs));

    if (this.backpressureActive) {
      if (heapRatio <= recoveryWatermark) {
        this.backpressureActive = false;
      }
    } else if (heapRatio >= highWatermark) {
      this.backpressureActive = true;
    }

    if (!this.backpressureActive) return 0;

    const normalized = this.clamp(
      (heapRatio - recoveryWatermark) / Math.max(1e-6, 1 - recoveryWatermark),
      0,
      1,
    );

    return Math.round(minDelayMs + normalized * (maxDelayMs - minDelayMs));
  }

  private heapRatio(): number {
    const used = this.memoryUsageReader().heapUsed;
    const heapLimit = this.heapLimitReader();
    if (!heapLimit || heapLimit <= 0) return 0;
    return this.clamp(used / heapLimit, 0, 1);
  }

  private ensureSmartBackoffState(bucketKey: string): SmartBackoffState {
    const existing = this.smartBackoffState.get(bucketKey);
    if (existing) return existing;

    const state: SmartBackoffState = {
      outcomes: [],
      consecutiveFailures: 0,
    };
    this.smartBackoffState.set(bucketKey, state);
    return state;
  }

  private trimOutcomes(state: SmartBackoffState, windowSize: number): void {
    const safeWindowSize = Math.max(1, Math.round(windowSize));
    if (state.outcomes.length <= safeWindowSize) return;
    state.outcomes.splice(0, state.outcomes.length - safeWindowSize);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }
}
