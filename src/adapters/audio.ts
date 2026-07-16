import type { GameEvent } from '../game/types';

export class SynthAudio {
  private context: AudioContext | null = null;
  private lastTurnAt = Number.NEGATIVE_INFINITY;

  constructor(
    private muted: boolean,
    private readonly contextFactory: () => AudioContext = () => new AudioContext(),
    private readonly now: () => number = () => performance.now(),
  ) {}

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  async unlock(): Promise<void> {
    this.context ??= this.contextFactory();
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  playStart(): void {
    if (this.muted || this.context === null) {
      return;
    }

    this.tone(this.context, 'triangle', 260, 620, 0.12);
  }

  playPause(): void {
    if (this.muted || this.context === null) {
      return;
    }

    this.tone(this.context, 'square', 300, 220, 0.06);
  }

  playEvent(event: GameEvent): void {
    if (this.muted || this.context === null) {
      return;
    }

    switch (event.type) {
      case 'foodEaten':
        this.tone(this.context, 'sine', 520, 760, 0.08);
        break;
      case 'speedChanged':
        this.tone(this.context, 'triangle', 640, 1040, 0.14);
        break;
      case 'gameOver':
        this.tone(this.context, 'sawtooth', 180, 55, 0.28);
        break;
      case 'completed':
        this.tone(this.context, 'triangle', 520, 1320, 0.42);
        break;
    }
  }

  playTurn(): void {
    if (this.muted || this.context === null) {
      return;
    }

    const now = this.now();
    if (now - this.lastTurnAt < 45) {
      return;
    }
    this.lastTurnAt = now;
    this.tone(this.context, 'sine', 420, 480, 0.035);
  }

  private tone(
    context: AudioContext,
    type: OscillatorType,
    startFrequency: number,
    endFrequency: number,
    duration: number,
  ): void {
    try {
      const startsAt = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(startFrequency, startsAt);
      oscillator.frequency.exponentialRampToValueAtTime(
        endFrequency,
        startsAt + duration,
      );
      gain.gain.setValueAtTime(0.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(0.12, startsAt + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startsAt);
      oscillator.stop(startsAt + duration + 0.02);
    } catch {
      // 音效失败不得中断游戏流程。
    }
  }
}
