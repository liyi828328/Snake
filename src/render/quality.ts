export type QualityLevel = 'low' | 'medium' | 'high';

export const QUALITY_PROFILES = {
  high: {
    particleLimit: 160,
    backgroundParticles: 72,
    blurQuality: 3,
    shake: true,
  },
  medium: {
    particleLimit: 96,
    backgroundParticles: 40,
    blurQuality: 2,
    shake: true,
  },
  low: {
    particleLimit: 24,
    backgroundParticles: 14,
    blurQuality: 1,
    shake: false,
  },
} as const;

export type QualityProfile = (typeof QUALITY_PROFILES)[QualityLevel];

export function selectProfile(
  reducedMotion: boolean,
  profile: QualityProfile,
): QualityProfile {
  return reducedMotion ? QUALITY_PROFILES.low : profile;
}

export class QualityGovernor {
  private currentLevel: QualityLevel;
  private readonly frameSamples: number[] = [];
  private consecutiveFastFrames = 0;

  constructor(
    initial: QualityLevel = 'high',
    private readonly reducedMotion = false,
  ) {
    this.currentLevel = reducedMotion ? 'low' : initial;
  }

  get level(): QualityLevel {
    return this.currentLevel;
  }

  get profile(): (typeof QUALITY_PROFILES)[QualityLevel] {
    return QUALITY_PROFILES[this.currentLevel];
  }

  sample(frameMs: number): void {
    if (
      this.reducedMotion ||
      !Number.isFinite(frameMs) ||
      frameMs <= 0
    ) {
      return;
    }

    if (this.currentLevel !== 'high') {
      if (frameMs < 9) {
        this.consecutiveFastFrames += 1;

        if (this.consecutiveFastFrames === 240) {
          this.currentLevel = this.currentLevel === 'low' ? 'medium' : 'high';
          this.consecutiveFastFrames = 0;
          this.frameSamples.length = 0;
          return;
        }
      } else {
        this.consecutiveFastFrames = 0;
      }
    }

    this.frameSamples.push(frameMs);

    if (this.frameSamples.length > 90) {
      this.frameSamples.shift();
    }

    if (this.frameSamples.length < 90 || this.currentLevel === 'low') {
      return;
    }

    const averageMs =
      this.frameSamples.reduce((total, sample) => total + sample, 0) /
      this.frameSamples.length;

    if (
      (this.currentLevel === 'high' && averageMs > 14) ||
      (this.currentLevel === 'medium' && averageMs > 19)
    ) {
      this.currentLevel = this.currentLevel === 'high' ? 'medium' : 'low';
      this.consecutiveFastFrames = 0;
      this.frameSamples.length = 0;
    }
  }
}
