import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Preferences } from '../adapters/storage';
import { SnakeEngine } from '../game/engine';
import type { GameEvent, GameSnapshot } from '../game/types';
import type { RendererPort } from '../render/game-renderer';
import type { HudView } from '../ui/hud';
import { GameController } from './game-controller';

class ManualFrames {
  private nextId = 1;
  readonly callbacks = new Map<number, FrameRequestCallback>();
  readonly request = vi.fn((callback: FrameRequestCallback): number => {
    const id = this.nextId;
    this.nextId += 1;
    this.callbacks.set(id, callback);
    return id;
  });
  readonly cancel = vi.fn((id: number): void => {
    this.callbacks.delete(id);
  });

  run(timestamp: number): void {
    const entry = this.callbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    if (!entry) {
      throw new Error('没有待执行的动画帧');
    }
    const [id, callback] = entry;
    this.callbacks.delete(id);
    callback(timestamp);
  }
}

class FakeRenderer implements RendererPort {
  readonly resets: GameSnapshot[] = [];
  readonly renders: Array<{
    previous: GameSnapshot;
    current: GameSnapshot;
    alpha: number;
    deltaMs: number;
  }> = [];
  readonly eventBatches: Array<readonly GameEvent[]> = [];
  readonly paused: boolean[] = [];
  destroyCalls = 0;

  async init(): Promise<void> {}
  reset(snapshot: GameSnapshot): void {
    this.resets.push(snapshot);
  }
  render(
    previous: GameSnapshot,
    current: GameSnapshot,
    alpha: number,
    deltaMs: number,
  ): void {
    this.renders.push({ previous, current, alpha, deltaMs });
  }
  handleEvents(events: readonly GameEvent[]): void {
    this.eventBatches.push(events);
  }
  setPaused(paused: boolean): void {
    this.paused.push(paused);
  }
  destroy(): void {
    this.destroyCalls += 1;
  }
}

class FakeHud implements HudView {
  readonly canvasHost = document.createElement('div');
  readonly updates: Array<{
    snapshot: GameSnapshot;
    bestScore: number;
    muted: boolean;
  }> = [];
  destroyCalls = 0;
  pulseCalls = 0;

  update(snapshot: GameSnapshot, bestScore: number, muted: boolean): void {
    this.updates.push({ snapshot, bestScore, muted });
  }
  showRendererError(): void {}
  showSmallViewportHint(): void {}
  pulseSpeed(): void {
    this.pulseCalls += 1;
  }
  destroy(): void {
    this.destroyCalls += 1;
  }
}

class FakeStore {
  readonly writes: Preferences[] = [];

  constructor(private preferences: Preferences = { bestScore: 0, muted: false }) {}

  read(): Preferences {
    return { ...this.preferences };
  }

  write(preferences: Preferences): void {
    this.preferences = { ...preferences };
    this.writes.push({ ...preferences });
  }
}

class FakeAudio {
  unlockCalls = 0;
  readonly muted: boolean[] = [];
  startCalls = 0;
  pauseCalls = 0;
  turnCalls = 0;
  readonly events: GameEvent[] = [];

  async unlock(): Promise<void> {
    this.unlockCalls += 1;
  }
  setMuted(muted: boolean): void {
    this.muted.push(muted);
  }
  playStart(): void {
    this.startCalls += 1;
  }
  playPause(): void {
    this.pauseCalls += 1;
  }
  playTurn(): void {
    this.turnCalls += 1;
  }
  playEvent(event: GameEvent): void {
    this.events.push(event);
  }
}

interface Harness {
  readonly engine: SnakeEngine;
  readonly renderer: FakeRenderer;
  readonly hud: FakeHud;
  readonly store: FakeStore;
  readonly audio: FakeAudio;
  readonly frames: ManualFrames;
  readonly controller: GameController;
}

function createHarness(options: {
  engine?: SnakeEngine;
  preferences?: Preferences;
  now?: () => number;
} = {}): Harness {
  const engine = options.engine ?? new SnakeEngine({
    width: 14,
    height: 10,
    random: () => 0,
  });
  const renderer = new FakeRenderer();
  const hud = new FakeHud();
  const store = new FakeStore(options.preferences);
  const audio = new FakeAudio();
  const frames = new ManualFrames();
  const controller = new GameController({
    engine,
    renderer,
    hud,
    store,
    audio,
    window,
    document,
    requestFrame: frames.request,
    cancelFrame: frames.cancel,
    now: options.now ?? (() => 0),
  });

  return { engine, renderer, hud, store, audio, frames, controller };
}

function press(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
}

describe('游戏控制器', () => {
  let harnesses: Harness[];

  beforeEach(() => {
    harnesses = [];
  });

  afterEach(() => {
    for (const harness of harnesses) {
      harness.controller.destroy();
    }
  });

  function setup(options: Parameters<typeof createHarness>[0] = {}): Harness {
    const harness = createHarness(options);
    harnesses.push(harness);
    return harness;
  }

  it('启动幂等并初始化渲染、HUD 且就绪态不启动动画帧', () => {
    const { controller, renderer, hud, frames } = setup({
      preferences: { bestScore: 42, muted: true },
    });

    controller.start();
    controller.start();

    expect(renderer.resets).toHaveLength(1);
    expect(renderer.resets[0]?.status).toBe('ready');
    expect(hud.updates).toHaveLength(1);
    expect(hud.updates[0]).toMatchObject({ bestScore: 42, muted: true });
    expect(frames.callbacks.size).toBe(0);
    expect(frames.request).not.toHaveBeenCalled();
  });

  it('就绪态窗口缩放只重绘一帧且不重复刷新 HUD', () => {
    const { controller, renderer, hud, frames } = setup();
    controller.start();
    const hudCount = hud.updates.length;

    window.dispatchEvent(new Event('resize'));
    expect(frames.callbacks.size).toBe(1);
    frames.run(16);

    expect(renderer.renders).toHaveLength(1);
    expect(hud.updates).toHaveLength(hudCount);
    expect(frames.callbacks.size).toBe(0);
  });

  it.each(['ready', 'paused'] as const)(
    '页面隐藏期间缩放后恢复可见会为 %s 合并一次静态重绘',
    (status) => {
      let hidden = false;
      const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => hidden,
      });
      const { controller, engine, renderer, hud, frames } = setup();

      try {
        controller.start();
        if (status === 'paused') {
          press(' ');
          press(' ');
        }
        expect(engine.snapshot().status).toBe(status);
        const renderCount = renderer.renders.length;
        const hudCount = hud.updates.length;

        hidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('resize'));
        expect(frames.callbacks.size).toBe(0);

        hidden = false;
        document.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
        expect(frames.callbacks.size).toBe(1);

        frames.run(1_000);
        expect(renderer.renders).toHaveLength(renderCount + 1);
        expect(hud.updates).toHaveLength(hudCount);
        expect(frames.callbacks.size).toBe(0);
      } finally {
        if (descriptor) {
          Object.defineProperty(document, 'hidden', descriptor);
        } else {
          delete (document as { hidden?: boolean }).hidden;
        }
      }
    },
  );

  it('停止后可重新启动且只恢复一组输入、监听器和动画帧', () => {
    const { controller, engine, renderer, hud, audio, frames } = setup();
    controller.start();

    controller.stop();
    press(' ');
    window.dispatchEvent(new Event('blur'));

    expect(frames.callbacks.size).toBe(0);
    expect(engine.snapshot().status).toBe('ready');
    expect(audio.unlockCalls).toBe(0);
    expect(renderer.destroyCalls).toBe(0);
    expect(hud.destroyCalls).toBe(0);

    controller.start();
    controller.start();

    expect(frames.callbacks.size).toBe(0);
    expect(frames.request).not.toHaveBeenCalled();
    expect(renderer.resets).toHaveLength(2);
    press(' ');
    expect(engine.snapshot().status).toBe('playing');
    expect(audio.unlockCalls).toBe(1);
    expect(frames.callbacks.size).toBe(1);
    expect(frames.request).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('blur'));
    expect(engine.snapshot().status).toBe('paused');
    expect(renderer.paused).toEqual([true]);
  });

  it('空格从就绪开始游戏并尝试解锁音频', () => {
    const { controller, engine, audio, hud } = setup();
    controller.start();

    press(' ');

    expect(engine.snapshot().status).toBe('playing');
    expect(audio.unlockCalls).toBe(1);
    expect(audio.startCalls).toBe(1);
    expect(hud.updates.at(-1)?.snapshot.status).toBe('playing');
  });

  it('仅在游戏中成功排队方向时播放转向音', () => {
    const { controller, audio } = setup();
    controller.start();

    press('ArrowUp');
    expect(audio.turnCalls).toBe(0);

    press(' ');
    press('ArrowUp');
    press('ArrowDown');

    expect(audio.unlockCalls).toBe(4);
    expect(audio.turnCalls).toBe(1);
  });

  it('空格暂停和继续时同步渲染器、HUD 与音效', () => {
    const { controller, engine, renderer, audio, hud } = setup();
    controller.start();
    press(' ');

    press(' ');
    expect(engine.snapshot().status).toBe('paused');
    expect(renderer.paused.at(-1)).toBe(true);
    expect(hud.updates.at(-1)?.snapshot.status).toBe('paused');

    press(' ');
    expect(engine.snapshot().status).toBe('playing');
    expect(renderer.paused.at(-1)).toBe(false);
    expect(audio.pauseCalls).toBe(2);
  });

  it('暂停立即固定画面并停止动画帧，继续时重置时间基准', () => {
    let now = 0;
    const { controller, engine, renderer, frames } = setup({ now: () => now });
    controller.start();
    press(' ');
    frames.run(150);

    press(' ');
    const paused = engine.snapshot();
    expect(frames.callbacks.size).toBe(0);
    expect(renderer.renders.at(-1)).toMatchObject({
      previous: paused,
      current: paused,
      alpha: 1,
      deltaMs: 0,
    });

    now = 1_000;
    press(' ');
    expect(frames.callbacks.size).toBe(1);
    frames.run(1_010);
    expect(renderer.renders.at(-1)?.deltaMs).toBe(10);
  });

  it('R 只在暂停或结束状态重新开始', () => {
    const { controller, engine, renderer } = setup();
    controller.start();

    press('r');
    expect(renderer.resets).toHaveLength(1);

    press(' ');
    press('R');
    expect(engine.snapshot().status).toBe('playing');
    expect(renderer.resets).toHaveLength(1);

    press(' ');
    press('R');
    expect(engine.snapshot().status).toBe('ready');
    expect(renderer.resets).toHaveLength(2);
  });

  it('真实引擎游戏结束后按 R 重新开始', () => {
    const engine = new SnakeEngine({ width: 5, height: 2, random: () => 0 });
    const { controller, renderer, frames } = setup({ engine });
    controller.start();
    press(' ');

    frames.run(150);
    frames.run(300);
    expect(engine.snapshot().status).toBe('gameOver');

    press('R');
    expect(engine.snapshot().status).toBe('ready');
    expect(renderer.resets).toHaveLength(2);
  });

  it('真实引擎占满棋盘后按 R 重新开始', () => {
    const engine = new SnakeEngine({ width: 5, height: 1, random: () => 0 });
    const { controller, renderer, frames } = setup({ engine });
    controller.start();
    press(' ');

    frames.run(150);
    expect(engine.snapshot().status).toBe('completed');

    press('R');
    expect(engine.snapshot().status).toBe('ready');
    expect(renderer.resets).toHaveLength(2);
  });

  it('M 反转静音并立即持久化和刷新 HUD', () => {
    const { controller, store, audio, hud } = setup({
      preferences: { bestScore: 12, muted: false },
    });
    controller.start();

    press('m');

    expect(audio.unlockCalls).toBe(1);
    expect(audio.muted).toEqual([true]);
    expect(store.writes).toEqual([{ bestScore: 12, muted: true }]);
    expect(hud.updates.at(-1)).toMatchObject({ bestScore: 12, muted: true });
  });

  it('150ms 帧推进一次并把事件批量交给渲染器和音频', () => {
    const foods = [
      { x: 5, y: 2 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
    ];
    const engine = new SnakeEngine({
      width: 8,
      height: 4,
      foodSpawner: () => foods.shift() ?? { x: 0, y: 0 },
    });
    const { controller, renderer, audio, frames } = setup({ engine });
    controller.start();
    press(' ');

    frames.run(150);

    expect(renderer.eventBatches).toHaveLength(1);
    expect(renderer.eventBatches[0]).toEqual([
      { type: 'foodEaten', at: { x: 5, y: 2 }, score: 10 },
    ]);
    expect(renderer.renders).toHaveLength(1);
    expect(renderer.renders[0]).toMatchObject({ alpha: 0, deltaMs: 150 });
    expect(renderer.renders[0]?.previous.body[0]).toEqual({ x: 4, y: 2 });
    expect(renderer.renders[0]?.current.body[0]).toEqual({ x: 5, y: 2 });
    expect(audio.events).toEqual(renderer.eventBatches[0]);
  });

  it('真实引擎推进一格后暂停时固定渲染暂停快照', () => {
    const { controller, engine, renderer, frames } = setup();
    controller.start();
    press(' ');
    frames.run(150);

    press(' ');
    const paused = engine.snapshot();

    const pausedRender = renderer.renders.at(-1);
    expect(paused.status).toBe('paused');
    expect(pausedRender?.previous).toEqual(paused);
    expect(pausedRender?.current).toEqual(paused);
    expect(pausedRender?.alpha).toBe(1);
    expect(frames.callbacks.size).toBe(0);
  });

  it('真实引擎占满棋盘的当前帧和后续帧都固定渲染最终蛇身', () => {
    const engine = new SnakeEngine({ width: 5, height: 1, random: () => 0 });
    const { controller, renderer, frames } = setup({ engine });
    controller.start();
    press(' ');

    frames.run(150);
    const completed = engine.snapshot();
    const completedRender = renderer.renders.at(-1);

    expect(completed.status).toBe('completed');
    expect(completed.body).toHaveLength(5);
    expect(completedRender?.previous).toEqual(completed);
    expect(completedRender?.current).toEqual(completed);
    expect(completedRender?.alpha).toBe(1);

    frames.run(300);
    const settledRender = renderer.renders.at(-1);
    expect(settledRender?.previous).toEqual(completed);
    expect(settledRender?.current).toEqual(completed);
    expect(settledRender?.previous.body).toHaveLength(5);
    expect(settledRender?.alpha).toBe(1);
  });

  it('游戏结束特效渲染满 220ms 后停止帧且不重复刷新 HUD', () => {
    const engine = new SnakeEngine({ width: 5, height: 2, random: () => 0 });
    const { controller, renderer, hud, frames } = setup({ engine });
    controller.start();
    press(' ');

    frames.run(150);
    frames.run(300);
    expect(engine.snapshot().status).toBe('gameOver');
    const renderCount = renderer.renders.length;
    const hudCount = hud.updates.length;

    frames.run(400);
    expect(renderer.renders).toHaveLength(renderCount + 1);
    expect(frames.callbacks.size).toBe(1);
    expect(hud.updates).toHaveLength(hudCount);

    frames.run(520);
    expect(renderer.renders).toHaveLength(renderCount + 2);
    expect(frames.callbacks.size).toBe(0);
    expect(hud.updates).toHaveLength(hudCount);
  });

  it('通关粒子雨渲染满 1200ms 后停止帧且不重复刷新 HUD', () => {
    const engine = new SnakeEngine({ width: 5, height: 1, random: () => 0 });
    const { controller, renderer, hud, frames } = setup({ engine });
    controller.start();
    press(' ');

    frames.run(150);
    expect(engine.snapshot().status).toBe('completed');
    const renderCount = renderer.renders.length;
    const hudCount = hud.updates.length;

    for (const timestamp of [400, 650, 900, 1_150]) {
      frames.run(timestamp);
    }
    expect(renderer.renders).toHaveLength(renderCount + 4);
    expect(frames.callbacks.size).toBe(1);
    expect(hud.updates).toHaveLength(hudCount);

    frames.run(1_350);
    expect(renderer.renders).toHaveLength(renderCount + 5);
    expect(frames.callbacks.size).toBe(0);
    expect(hud.updates).toHaveLength(hudCount);
  });

  it('分数超过最高分时在当前帧立即写入偏好', () => {
    const foods = [
      { x: 5, y: 2 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 4, y: 0 },
      { x: 5, y: 0 },
    ];
    const engine = new SnakeEngine({
      width: 8,
      height: 4,
      foodSpawner: () => foods.shift() ?? { x: 0, y: 0 },
    });
    const { controller, store, hud, frames } = setup({
      engine,
      preferences: { bestScore: 5, muted: false },
    });
    controller.start();
    press(' ');

    frames.run(150);

    expect(store.writes).toEqual([{ bestScore: 10, muted: false }]);
    expect(hud.updates.at(-1)?.bestScore).toBe(10);
  });

  it('窗口失焦会自动暂停正在进行的游戏', () => {
    const { controller, engine, renderer, hud } = setup();
    controller.start();
    press(' ');

    window.dispatchEvent(new Event('blur'));

    expect(engine.snapshot().status).toBe('paused');
    expect(renderer.paused.at(-1)).toBe(true);
    expect(hud.updates.at(-1)?.snapshot.status).toBe('paused');
  });

  it('游戏中页面隐藏会暂停，重新可见后只补一个静态帧', () => {
    let hidden = false;
    let now = 0;
    const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
    const { controller, engine, frames } = setup({ now: () => now });
    controller.start();
    press(' ');

    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(engine.snapshot().status).toBe('paused');
    expect(frames.callbacks.size).toBe(0);
    expect(frames.cancel).toHaveBeenCalledTimes(1);

    now = 1_000;
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(engine.snapshot().status).toBe('paused');
    expect(frames.callbacks.size).toBe(1);
    frames.run(1_016);
    expect(frames.callbacks.size).toBe(0);

    if (descriptor) {
      Object.defineProperty(document, 'hidden', descriptor);
    } else {
      delete (document as { hidden?: boolean }).hidden;
    }
  });

  it('终态特效隐藏后恢复只保留一个动画帧', () => {
    let hidden = false;
    let now = 0;
    const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
    const engine = new SnakeEngine({ width: 5, height: 2, random: () => 0 });
    const { controller, frames } = setup({ engine, now: () => now });

    try {
      controller.start();
      press(' ');
      frames.run(150);
      frames.run(300);
      expect(engine.snapshot().status).toBe('gameOver');

      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('resize'));
      expect(frames.callbacks.size).toBe(0);

      now = 1_000;
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
      expect(frames.callbacks.size).toBe(1);

      frames.run(1_100);
      expect(frames.callbacks.size).toBe(1);
    } finally {
      if (descriptor) {
        Object.defineProperty(document, 'hidden', descriptor);
      } else {
        delete (document as { hidden?: boolean }).hidden;
      }
    }
  });

  it('销毁幂等并清理帧、输入、监听器、渲染器和 HUD', () => {
    const { controller, engine, renderer, hud, audio, frames } = setup();
    controller.start();

    controller.destroy();
    controller.destroy();
    press(' ');
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('visibilitychange'));

    expect(frames.callbacks.size).toBe(0);
    expect(engine.snapshot().status).toBe('ready');
    expect(audio.unlockCalls).toBe(0);
    expect(renderer.destroyCalls).toBe(1);
    expect(hud.destroyCalls).toBe(1);
  });
});
