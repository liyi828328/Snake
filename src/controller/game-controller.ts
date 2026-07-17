import type { Preferences } from '../adapters/storage';
import type { SynthAudio } from '../adapters/audio';
import type { PreferenceStore } from '../adapters/storage';
import { FixedStepClock } from '../game/clock';
import type { SnakeEngine } from '../game/engine';
import { KeyboardInput } from '../game/input';
import type { InputCommand } from '../game/input';
import type { GameEvent, GameSnapshot } from '../game/types';
import type { RendererPort } from '../render/game-renderer';
import type { HudView } from '../ui/hud';

const GAME_OVER_ANIMATION_MS = 220;
const COMPLETION_ANIMATION_MS = 1_200;

export type PreferenceStorePort = Pick<PreferenceStore, 'read' | 'write'>;
export type AudioPort = Pick<
  SynthAudio,
  'unlock' | 'setMuted' | 'playStart' | 'playPause' | 'playTurn' | 'playEvent'
>;

export interface GameControllerOptions {
  readonly engine: SnakeEngine;
  readonly renderer: RendererPort;
  readonly hud: HudView;
  readonly store: PreferenceStorePort;
  readonly audio: AudioPort;
  readonly window: Window;
  readonly document: Document;
  readonly requestFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelFrame?: (frameId: number) => void;
  readonly now?: () => number;
}

export class GameController {
  private readonly engine: SnakeEngine;
  private readonly renderer: RendererPort;
  private readonly hud: HudView;
  private readonly store: PreferenceStorePort;
  private readonly audio: AudioPort;
  private readonly window: Window;
  private readonly document: Document;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (frameId: number) => void;
  private readonly now: () => number;
  private readonly input: KeyboardInput;
  private readonly clock = new FixedStepClock();
  private preferences: Preferences;
  private previousSnapshot: GameSnapshot;
  private frameId: number | null = null;
  private previousTimestamp: number | null = null;
  private running = false;
  private hidden = false;
  private destroyed = false;
  private terminalAnimationRemainingMs = 0;
  private lastHudSnapshot: GameSnapshot | null = null;
  private lastHudBestScore = Number.NaN;
  private lastHudMuted: boolean | null = null;

  private readonly handleFrame = (timestamp: number): void => {
    this.frameId = null;
    if (!this.running || this.hidden || this.destroyed) {
      return;
    }

    const previousTimestamp = this.previousTimestamp ?? timestamp;
    const rawDelta = timestamp - previousTimestamp;
    const deltaMs = Number.isFinite(rawDelta)
      ? Math.min(250, Math.max(0, rawDelta))
      : 0;
    this.previousTimestamp = Number.isFinite(timestamp) ? timestamp : previousTimestamp;

    const before = this.engine.snapshot();
    let current = before;
    let alpha = 0;
    const events: GameEvent[] = [];

    if (before.status === 'playing') {
      this.engine.advanceTime(deltaMs);
      current = this.engine.snapshot();
      const result = this.clock.consume(deltaMs, current.tickMs);
      alpha = result.alpha;
      for (let step = 0; step < result.steps; step += 1) {
        this.previousSnapshot = current;
        events.push(...this.engine.step());
        current = this.engine.snapshot();
        if (current.status !== 'playing') {
          break;
        }
      }
    }

    let renderPrevious = this.previousSnapshot;
    if (current.status !== 'playing') {
      this.previousSnapshot = current;
      renderPrevious = current;
      alpha = 1;
    }
    const terminalAnimationStarted = this.startTerminalAnimation(events);
    this.renderer.handleEvents(events);
    this.renderer.render(renderPrevious, current, alpha, deltaMs);
    for (const event of events) {
      this.audio.playEvent(event);
    }

    if (current.score > this.preferences.bestScore) {
      this.preferences = {
        ...this.preferences,
        bestScore: current.score,
      };
      this.store.write(this.preferences);
    }
    this.updateHud(current);

    if (current.status === 'playing') {
      this.scheduleFrame();
      return;
    }
    if (!terminalAnimationStarted) {
      this.terminalAnimationRemainingMs = Math.max(
        0,
        this.terminalAnimationRemainingMs - deltaMs,
      );
    }
    if (this.terminalAnimationRemainingMs > 0) {
      this.scheduleFrame();
    } else {
      this.previousTimestamp = null;
    }
  };

  private readonly handleBlur = (): void => {
    this.pauseIfPlaying();
  };

  private readonly handleResize = (): void => {
    this.scheduleFrame();
  };

  private readonly handleVisibilityChange = (): void => {
    if (this.document.hidden) {
      if (this.hidden) {
        return;
      }
      this.hidden = true;
      this.pauseIfPlaying();
      this.cancelScheduledFrame();
      return;
    }

    if (!this.hidden) {
      return;
    }
    this.hidden = false;
    this.previousTimestamp = this.now();
    this.clock.reset();
    // 隐藏期间的缩放不会排帧，恢复时统一补一帧以刷新静态场景布局。
    this.scheduleFrame();
  };

  constructor(options: GameControllerOptions) {
    this.engine = options.engine;
    this.renderer = options.renderer;
    this.hud = options.hud;
    this.store = options.store;
    this.audio = options.audio;
    this.window = options.window;
    this.document = options.document;
    this.requestFrame = options.requestFrame
      ?? this.window.requestAnimationFrame.bind(this.window);
    this.cancelFrame = options.cancelFrame
      ?? this.window.cancelAnimationFrame.bind(this.window);
    this.now = options.now ?? (() => performance.now());
    this.preferences = this.store.read();
    this.previousSnapshot = this.engine.snapshot();
    this.hidden = this.document.hidden;
    this.input = new KeyboardInput(this.window, this.handleCommand);
  }

  start(): void {
    if (this.running || this.destroyed) {
      return;
    }
    this.running = true;
    this.hidden = this.document.hidden;
    this.previousTimestamp = this.now();
    this.previousSnapshot = this.engine.snapshot();
    this.input.start();
    this.window.addEventListener('blur', this.handleBlur);
    this.window.addEventListener('resize', this.handleResize);
    this.document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.renderer.reset(this.previousSnapshot);
    this.updateHud(this.previousSnapshot);
    if (this.previousSnapshot.status === 'playing') {
      this.scheduleFrame();
    }
  }

  stop(): void {
    if (this.destroyed) {
      return;
    }
    this.running = false;
    this.cancelScheduledFrame();
    this.previousTimestamp = null;
    this.terminalAnimationRemainingMs = 0;
    this.clock.reset();
    this.input.stop();
    this.window.removeEventListener('blur', this.handleBlur);
    this.window.removeEventListener('resize', this.handleResize);
    this.document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.stop();
    this.destroyed = true;
    this.renderer.destroy();
    this.hud.destroy();
  }

  toggleMute(): void {
    if (!this.destroyed) {
      this.handleCommand({ type: 'toggleMute' });
    }
  }

  private readonly handleCommand = (command: InputCommand): void => {
    if (!this.running || this.destroyed) {
      return;
    }
    void this.audio.unlock().catch(() => undefined);

    switch (command.type) {
      case 'direction':
        if (
          this.engine.snapshot().status === 'playing'
          && this.engine.queueDirection(command.direction)
        ) {
          this.audio.playTurn();
        }
        return;

      case 'togglePause':
        this.togglePause();
        return;

      case 'restart':
        this.restart();
        return;

      case 'toggleMute':
        this.preferences = {
          ...this.preferences,
          muted: !this.preferences.muted,
        };
        this.audio.setMuted(this.preferences.muted);
        this.store.write(this.preferences);
        this.updateHud();
    }
  };

  private togglePause(): void {
    const status = this.engine.snapshot().status;
    if (status === 'ready') {
      if (this.engine.start()) {
        this.audio.playStart();
        this.previousSnapshot = this.engine.snapshot();
        this.terminalAnimationRemainingMs = 0;
        this.clock.reset();
        this.previousTimestamp = this.now();
        this.updateHud(this.previousSnapshot);
        this.scheduleFrame();
      }
      return;
    }

    if (status !== 'playing' && status !== 'paused') {
      return;
    }
    if (!this.engine.togglePause()) {
      return;
    }
    this.audio.playPause();
    this.clock.reset();
    const snapshot = this.engine.snapshot();
    const paused = snapshot.status === 'paused';
    this.renderer.setPaused(paused);
    this.previousTimestamp = this.now();
    this.previousSnapshot = snapshot;
    this.terminalAnimationRemainingMs = 0;
    if (paused) {
      this.cancelScheduledFrame();
      this.renderer.render(snapshot, snapshot, 1, 0);
    } else {
      this.scheduleFrame();
    }
    this.updateHud(snapshot);
  }

  private restart(): void {
    const status = this.engine.snapshot().status;
    if (status !== 'paused' && status !== 'gameOver' && status !== 'completed') {
      return;
    }
    if (!this.engine.restart()) {
      return;
    }
    this.cancelScheduledFrame();
    this.terminalAnimationRemainingMs = 0;
    this.clock.reset();
    this.previousTimestamp = this.now();
    this.previousSnapshot = this.engine.snapshot();
    this.renderer.reset(this.previousSnapshot);
    this.updateHud(this.previousSnapshot);
  }

  private pauseIfPlaying(): void {
    if (!this.running || this.engine.snapshot().status !== 'playing') {
      return;
    }
    this.engine.togglePause();
    this.clock.reset();
    this.previousTimestamp = this.now();
    this.cancelScheduledFrame();
    this.renderer.setPaused(true);
    const snapshot = this.engine.snapshot();
    this.previousSnapshot = snapshot;
    this.terminalAnimationRemainingMs = 0;
    this.renderer.render(snapshot, snapshot, 1, 0);
    this.updateHud(snapshot);
  }

  private updateHud(snapshot: GameSnapshot = this.engine.snapshot()): void {
    if (
      snapshot === this.lastHudSnapshot
      && this.preferences.bestScore === this.lastHudBestScore
      && this.preferences.muted === this.lastHudMuted
    ) {
      return;
    }
    this.hud.update(
      snapshot,
      this.preferences.bestScore,
      this.preferences.muted,
    );
    this.lastHudSnapshot = snapshot;
    this.lastHudBestScore = this.preferences.bestScore;
    this.lastHudMuted = this.preferences.muted;
  }

  private startTerminalAnimation(events: readonly GameEvent[]): boolean {
    let durationMs = 0;
    for (const event of events) {
      if (event.type === 'gameOver') {
        durationMs = Math.max(durationMs, GAME_OVER_ANIMATION_MS);
      } else if (event.type === 'completed') {
        durationMs = Math.max(durationMs, COMPLETION_ANIMATION_MS);
      }
    }
    if (durationMs === 0) {
      return false;
    }
    this.terminalAnimationRemainingMs = durationMs;
    return true;
  }

  private scheduleFrame(): void {
    if (!this.running || this.hidden || this.destroyed || this.frameId !== null) {
      return;
    }
    this.frameId = this.requestFrame(this.handleFrame);
  }

  private cancelScheduledFrame(): void {
    if (this.frameId === null) {
      return;
    }
    this.cancelFrame(this.frameId);
    this.frameId = null;
  }
}
