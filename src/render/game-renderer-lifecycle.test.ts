// 使用 Node 环境与最小 DOM fake，避免 jsdom 画布探测噪声。
// @vitest-environment node

import { Container, Graphics } from 'pixi.js';
import type { Application } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import type { GameSnapshot } from '../game/types';
import { GameRenderer } from './game-renderer';
import type { GameRendererOptions } from './game-renderer';
import { QualityGovernor } from './quality';
import { THEME } from './theme';

vi.mock('pixi.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pixi.js')>();

  class FakeBlurFilter {
    quality = 1;
    strength = 0;
    destroy = vi.fn();

    constructor(options?: { quality?: number; strength?: number }) {
      this.quality = options?.quality ?? 1;
      this.strength = options?.strength ?? 0;
    }
  }

  return { ...actual, BlurFilter: FakeBlurFilter };
});

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
}

interface FakeApplication {
  readonly application: Application;
  readonly canvas: HTMLCanvasElement & { parentElement: HTMLElement | null };
  readonly init: ReturnType<typeof vi.fn>;
  readonly render: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
}

interface FakeHost {
  readonly element: HTMLElement;
  readonly children: HTMLCanvasElement[];
  readonly appendChild: ReturnType<typeof vi.fn>;
  readonly removeChild: ReturnType<typeof vi.fn>;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFakeApplication(initialization: Promise<void>): FakeApplication {
  const canvas = {
    parentElement: null,
    setAttribute: vi.fn(),
    style: {},
  } as unknown as HTMLCanvasElement & { parentElement: HTMLElement | null };
  const init = vi.fn(() => initialization);
  const render = vi.fn();
  const destroy = vi.fn();
  const application = {
    canvas,
    destroy,
    init,
    render,
    screen: { width: 1_200, height: 900 },
    stage: new Container(),
  } as unknown as Application;

  return { application, canvas, init, render, destroy };
}

function createFakeHost(): FakeHost {
  const children: HTMLCanvasElement[] = [];
  const host = {} as HTMLElement;
  const appendChild = vi.fn((child: HTMLCanvasElement) => {
    children.push(child);
    Object.assign(child, { parentElement: host });
    return child;
  });
  const removeChild = vi.fn((child: HTMLCanvasElement) => {
    const index = children.indexOf(child);
    if (index >= 0) {
      children.splice(index, 1);
    }
    Object.assign(child, { parentElement: null });
    return child;
  });
  Object.assign(host, { appendChild, removeChild, dispatchEvent: vi.fn() });
  return { element: host, children, appendChild, removeChild };
}

function createMotionQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MediaQueryList;
}

function rendererOptions(
  applicationFactory: () => Application,
  overrides: Omit<GameRendererOptions, 'applicationFactory'> = {},
): GameRendererOptions {
  return { ...overrides, applicationFactory };
}

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    width: 40,
    height: 24,
    body: [{ x: 2, y: 3 }],
    foods: [{ x: 10, y: 8, kind: 'normal' }],
    direction: 'right',
    status: 'playing',
    score: 0,
    foodCount: 0,
    tickMs: 120,
    ...overrides,
  };
}

function foodLayer(application: Application): Container {
  const scene = application.stage.children[0] as Container;
  return scene.children[5] as Container;
}

describe('渲染器生命周期', () => {
  it('并发初始化只创建并挂载一个 Application', async () => {
    const host = createFakeHost();
    const initialization = createDeferred();
    const fake = createFakeApplication(initialization.promise);
    const applicationFactory = vi.fn(() => fake.application);
    const renderer = new GameRenderer(
      host.element,
      rendererOptions(applicationFactory),
    );

    const first = renderer.init();
    const second = renderer.init();
    void first.catch(() => undefined);
    void second.catch(() => undefined);

    try {
      expect(applicationFactory).toHaveBeenCalledTimes(1);
      expect(fake.init).toHaveBeenCalledTimes(1);

      initialization.resolve();
      await Promise.all([first, second]);

      expect(host.children).toEqual([fake.canvas]);
      expect(host.appendChild).toHaveBeenCalledTimes(1);
      expect(fake.render).toHaveBeenCalledTimes(1);
    } finally {
      renderer.destroy();
    }
  });

  it('初始化等待期间销毁后不会挂载或复活 Application', async () => {
    const host = createFakeHost();
    const initialization = createDeferred();
    const fake = createFakeApplication(initialization.promise);
    const renderer = new GameRenderer(
      host.element,
      rendererOptions(() => fake.application),
    );

    const pending = renderer.init();
    renderer.destroy();

    expect(fake.destroy).not.toHaveBeenCalled();
    expect(host.appendChild).not.toHaveBeenCalled();

    initialization.resolve();

    await expect(pending).rejects.toThrow('渲染器已销毁');
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(host.appendChild).not.toHaveBeenCalled();
    expect(host.children).toHaveLength(0);
  });

  it('初始化失败会彻底清理且未销毁实例可以重试', async () => {
    const host = createFakeHost();
    const firstInitialization = createDeferred();
    const secondInitialization = createDeferred();
    const firstFake = createFakeApplication(firstInitialization.promise);
    const secondFake = createFakeApplication(secondInitialization.promise);
    const applicationFactory = vi
      .fn<() => Application>()
      .mockReturnValueOnce(firstFake.application)
      .mockReturnValueOnce(secondFake.application);
    const renderer = new GameRenderer(
      host.element,
      rendererOptions(applicationFactory),
    );

    const first = renderer.init();
    firstInitialization.reject(new Error('webgl init failed'));

    await expect(first).rejects.toThrow('webgl init failed');
    expect(firstFake.destroy).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(0);

    const second = renderer.init();
    expect(applicationFactory).toHaveBeenCalledTimes(2);
    expect(secondFake.init).toHaveBeenCalledTimes(1);
    secondInitialization.resolve();
    await expect(second).resolves.toBeUndefined();
    expect(host.children).toEqual([secondFake.canvas]);

    renderer.destroy();
  });

  it('减少动态时 render 不采样 governor', async () => {
    const host = createFakeHost();
    const fake = createFakeApplication(Promise.resolve());
    const governor = new QualityGovernor('high', false);
    const sampleGovernor = vi.spyOn(governor, 'sample');
    const renderer = new GameRenderer(
      host.element,
      rendererOptions(() => fake.application, {
        governor,
        reducedMotion: true,
      }),
    );
    await renderer.init();

    const state = snapshot();
    renderer.render(state, state, 1, 16);

    expect(sampleGovernor).not.toHaveBeenCalled();
    expect(governor.level).toBe('high');
    renderer.destroy();
  });

  it('同时绘制普通食物和金色奖励食物', async () => {
    const host = createFakeHost();
    const fake = createFakeApplication(Promise.resolve());
    const renderer = new GameRenderer(
      host.element,
      rendererOptions(() => fake.application),
    );
    await renderer.init();

    const state = snapshot({
      foods: [
        { x: 4, y: 5, kind: 'normal' },
        { x: 12, y: 9, kind: 'bonus' },
      ],
    });
    renderer.render(state, state, 1, 0);

    const foods = foodLayer(fake.application).children as Container[];
    expect(foods).toHaveLength(2);
    expect(foods.filter(({ visible }) => visible)).toHaveLength(2);
    expect((foods[0]!.children[2] as Graphics).tint).toBe(THEME.food);
    expect((foods[1]!.children[2] as Graphics).tint).toBe(THEME.bonusFood);
    expect((foods[0]!.children[3] as Graphics).tint).toBe(THEME.food);
    expect((foods[1]!.children[3] as Graphics).tint).toBe(THEME.bonusFood);
    expect(foods[0]!.position.x).not.toBe(foods[1]!.position.x);
    expect(foods[0]!.position.y).not.toBe(foods[1]!.position.y);

    renderer.destroy();
  });

  it('金色奖励食物的光环会向外扩张并淡出', async () => {
    const host = createFakeHost();
    const fake = createFakeApplication(Promise.resolve());
    const renderer = new GameRenderer(
      host.element,
      rendererOptions(() => fake.application),
    );
    await renderer.init();

    const state = snapshot({ foods: [{ x: 10, y: 8, kind: 'bonus' }] });
    renderer.render(state, state, 1, 0);
    const visual = foodLayer(fake.application).children[0] as Container;
    const firstRing = visual.children[0] as Graphics;
    const secondRing = visual.children[1] as Graphics;
    const initialFirstScale = firstRing.scale.x;
    const initialFirstAlpha = firstRing.alpha;
    const initialSecondScale = secondRing.scale.x;
    const initialSecondAlpha = secondRing.alpha;

    expect(initialSecondScale).toBeGreaterThan(initialFirstScale);
    expect(initialSecondAlpha).toBeLessThan(initialFirstAlpha);

    renderer.render(state, state, 1, 350);

    expect(firstRing.scale.x).toBeGreaterThan(initialFirstScale);
    expect(firstRing.alpha).toBeLessThan(initialFirstAlpha);
    expect(secondRing.scale.x).toBeGreaterThan(initialSecondScale);
    expect(secondRing.alpha).toBeLessThan(initialSecondAlpha);
    expect(secondRing.scale.x).not.toBe(firstRing.scale.x);
    expect(secondRing.alpha).not.toBe(firstRing.alpha);
    renderer.destroy();
  });

  it('食物减少时隐藏多余容器并在再次增加时复用', async () => {
    const host = createFakeHost();
    const fake = createFakeApplication(Promise.resolve());
    const renderer = new GameRenderer(
      host.element,
      rendererOptions(() => fake.application),
    );
    await renderer.init();

    const twoFoods = snapshot({
      foods: [
        { x: 4, y: 5, kind: 'normal' },
        { x: 12, y: 9, kind: 'bonus' },
      ],
    });
    renderer.render(twoFoods, twoFoods, 1, 0);
    const layer = foodLayer(fake.application);
    const secondVisual = layer.children[1];

    const oneFood = snapshot({ foods: [twoFoods.foods[0]!] });
    renderer.render(oneFood, oneFood, 1, 0);
    expect(layer.children).toHaveLength(2);
    expect(layer.children[0]!.visible).toBe(true);
    expect(layer.children[1]!.visible).toBe(false);

    renderer.render(twoFoods, twoFoods, 1, 0);
    expect(layer.children[1]).toBe(secondVisual);
    expect(layer.children[1]!.visible).toBe(true);
    renderer.destroy();
  });

  it('减少动态时金色奖励食物保持静态可见光环', async () => {
    const host = createFakeHost();
    const fake = createFakeApplication(Promise.resolve());
    const renderer = new GameRenderer(
      host.element,
      rendererOptions(() => fake.application, { reducedMotion: true }),
    );
    await renderer.init();

    const state = snapshot({ foods: [{ x: 10, y: 8, kind: 'bonus' }] });
    renderer.render(state, state, 1, 0);
    const visual = foodLayer(fake.application).children[0] as Container;
    const firstRing = visual.children[0] as Graphics;
    const outer = visual.children[2] as Graphics;
    const initialScale = firstRing.scale.x;
    const initialAlpha = firstRing.alpha;

    renderer.render(state, state, 1, 350);

    expect(firstRing.scale.x).toBe(initialScale);
    expect(firstRing.alpha).toBe(initialAlpha);
    expect(firstRing.alpha).toBeGreaterThan(0);
    expect(outer.tint).toBe(THEME.bonusFood);
    renderer.destroy();
  });

  it('首次绘制时按需创建十六个食物容器并在后续帧中复用', async () => {
    const host = createFakeHost();
    const fake = createFakeApplication(Promise.resolve());
    const renderer = new GameRenderer(
      host.element,
      rendererOptions(() => fake.application),
    );
    await renderer.init();
    const layer = foodLayer(fake.application);
    expect(layer.children).toHaveLength(0);

    const sixteenFoods = snapshot({
      foods: Array.from({ length: 16 }, (_, index) => ({
        x: index,
        y: index % 4,
        kind: index < 6 ? 'normal' as const : 'bonus' as const,
      })),
    });
    renderer.render(sixteenFoods, sixteenFoods, 1, 0);
    const visuals = [...layer.children];

    const sixFoods = snapshot({ foods: sixteenFoods.foods.slice(0, 6) });
    renderer.render(sixFoods, sixFoods, 1, 16);
    renderer.render(sixFoods, sixFoods, 1, 16);

    expect(layer.children).toHaveLength(16);
    expect(layer.children.filter(({ visible }) => visible)).toHaveLength(6);
    expect([...layer.children]).toEqual(visuals);

    const noFoods = snapshot({ foods: [] });
    renderer.render(noFoods, noFoods, 1, 16);
    expect(layer.children).toHaveLength(16);
    expect(layer.children.every(({ visible }) => !visible)).toBe(true);
    expect([...layer.children]).toEqual(visuals);
    renderer.destroy();
  });

  it('食物池存在时会随画面与自定义棋盘尺寸重绘几何', async () => {
    const host = createFakeHost();
    const fake = createFakeApplication(Promise.resolve());
    const renderer = new GameRenderer(
      host.element,
      rendererOptions(() => fake.application),
    );
    await renderer.init();

    const initial = snapshot({
      foods: [
        { x: 4, y: 5, kind: 'normal' },
        { x: 12, y: 9, kind: 'bonus' },
      ],
    });
    renderer.render(initial, initial, 1, 0);
    const layer = foodLayer(fake.application);
    const firstVisual = layer.children[0] as Container;
    const initialOuterWidth = (
      firstVisual.children[2] as Graphics
    ).getLocalBounds().width;
    const initialX = firstVisual.position.x;

    Object.assign(fake.application.screen, { width: 640, height: 480 });
    const resized = snapshot({ width: 20, height: 12, foods: initial.foods });
    expect(() => renderer.render(resized, resized, 1, 0)).not.toThrow();

    expect(layer.children).toHaveLength(2);
    expect(layer.children[0]).toBe(firstVisual);
    expect(firstVisual.position.x).not.toBe(initialX);
    expect((firstVisual.children[2] as Graphics).getLocalBounds().width)
      .not.toBe(initialOuterWidth);
    renderer.destroy();
  });

  it('系统减少动态媒体查询启用低质量并关闭震动与故障切片', async () => {
    const motionQuery = createMotionQuery(true);
    const matchMedia = vi.fn(() => motionQuery);
    vi.stubGlobal('window', { devicePixelRatio: 1, matchMedia });
    const host = createFakeHost();
    const fake = createFakeApplication(Promise.resolve());
    const renderer = new GameRenderer(
      host.element,
      rendererOptions(() => fake.application),
    );

    try {
      await renderer.init();
      expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
      const scene = fake.application.stage.children[0] as Container;
      const glowLayer = scene.children[3] as Container;
      const glowFilter = glowLayer.filters?.[0] as unknown as { quality: number };
      expect(glowFilter.quality).toBe(1);

      const state = snapshot();
      renderer.handleEvents([{ type: 'gameOver', at: { x: 32, y: 12 } }]);
      renderer.render(state, state, 1, 16);
      expect(scene.position.x).toBe(0);
      expect(scene.position.y).toBe(0);
      const impactLayer = scene.children[7] as Container;
      expect(
        impactLayer.children.slice(2).every((slice) => !slice.visible),
      ).toBe(true);

      renderer.handleEvents([{ type: 'completed', score: 100 }]);
      const particlesLayer = scene.children[6] as Container;
      expect(
        particlesLayer.children.filter((particle) => particle.visible),
      ).toHaveLength(24);
    } finally {
      renderer.destroy();
      vi.unstubAllGlobals();
    }
  });

  it('暂停时立即清除尚未结束的场景震动偏移', async () => {
    const host = createFakeHost();
    const fake = createFakeApplication(Promise.resolve());
    const renderer = new GameRenderer(
      host.element,
      rendererOptions(() => fake.application),
    );
    await renderer.init();
    const scene = fake.application.stage.children[0] as Container;
    scene.position.set(6, -4);

    renderer.setPaused(true);

    expect(scene.position.x).toBe(0);
    expect(scene.position.y).toBe(0);
    renderer.destroy();
  });
});
