export type TimedEffect =
  | 'gridPulse'
  | 'speedPulse'
  | 'flash'
  | 'shake'
  | 'glitch';

interface EffectTimer {
  remainingMs: number;
  fresh: boolean;
}

const EFFECT_NAMES: readonly TimedEffect[] = [
  'gridPulse',
  'speedPulse',
  'flash',
  'shake',
  'glitch',
];

export class EffectTimeline {
  private readonly timers: Record<TimedEffect, EffectTimer> = {
    gridPulse: { remainingMs: 0, fresh: false },
    speedPulse: { remainingMs: 0, fresh: false },
    flash: { remainingMs: 0, fresh: false },
    shake: { remainingMs: 0, fresh: false },
    glitch: { remainingMs: 0, fresh: false },
  };

  start(effect: TimedEffect, durationMs: number): void {
    const timer = this.timers[effect];
    timer.remainingMs = Number.isFinite(durationMs)
      ? Math.max(0, durationMs)
      : 0;
    timer.fresh = timer.remainingMs > 0;
  }

  remaining(effect: TimedEffect): number {
    return this.timers[effect].remainingMs;
  }

  advance(deltaMs: number, paused: boolean): void {
    if (paused || !Number.isFinite(deltaMs) || deltaMs <= 0) {
      return;
    }

    for (const effect of EFFECT_NAMES) {
      const timer = this.timers[effect];
      if (timer.fresh) {
        timer.fresh = false;
        continue;
      }
      timer.remainingMs = Math.max(0, timer.remainingMs - deltaMs);
    }
  }

  stop(effect: TimedEffect): void {
    const timer = this.timers[effect];
    timer.remainingMs = 0;
    timer.fresh = false;
  }

  reset(): void {
    for (const effect of EFFECT_NAMES) {
      this.stop(effect);
    }
  }
}

export function gameOverEffectDurations(reducedMotion: boolean): {
  readonly flashMs: number;
  readonly shakeMs: number;
  readonly glitchMs: number;
} {
  return {
    flashMs: 120,
    shakeMs: reducedMotion ? 0 : 220,
    glitchMs: reducedMotion ? 0 : 120,
  };
}
