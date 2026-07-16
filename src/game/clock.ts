export interface ClockResult {
  readonly steps: number;
  readonly alpha: number;
}

export class FixedStepClock {
  private accumulatedMs = 0;

  constructor(private readonly maximumSteps = 4) {
    if (!Number.isSafeInteger(maximumSteps) || maximumSteps <= 0) {
      throw new Error('最大步数必须为正安全整数');
    }
  }

  consume(deltaMs: number, tickMs: number): ClockResult {
    if (!Number.isFinite(tickMs) || tickMs <= 0) {
      throw new Error('节拍间隔必须为正有限数');
    }

    // 新 delta 单独限制；旧积压必须完整保留，不能用 alpha 回写。
    const normalizedDeltaMs = Number.isNaN(deltaMs) || deltaMs < 0 ? 0 : deltaMs;
    let newWholeSteps: number;
    let newRemainderMs: number;

    if (normalizedDeltaMs === Number.POSITIVE_INFINITY) {
      newWholeSteps = this.maximumSteps;
      newRemainderMs = 0;
    } else {
      const wholeSteps = Math.floor(normalizedDeltaMs / tickMs);

      if (wholeSteps >= this.maximumSteps) {
        newWholeSteps = this.maximumSteps;
        newRemainderMs = 0;
      } else {
        newWholeSteps = wholeSteps;
        newRemainderMs = normalizedDeltaMs - wholeSteps * tickMs;
      }
    }

    if (newRemainderMs > 0) {
      const timeUntilNextStep = tickMs - newRemainderMs;

      if (this.accumulatedMs >= timeUntilNextStep) {
        this.accumulatedMs -= timeUntilNextStep;
        newWholeSteps += 1;
      } else {
        this.accumulatedMs += newRemainderMs;
      }
    }

    let steps = Math.min(this.maximumSteps, newWholeSteps);

    while (this.accumulatedMs >= tickMs && steps < this.maximumSteps) {
      this.accumulatedMs -= tickMs;
      steps += 1;
    }

    return {
      steps,
      alpha: Math.min(1, this.accumulatedMs / tickMs),
    };
  }

  reset(): void {
    this.accumulatedMs = 0;
  }
}
