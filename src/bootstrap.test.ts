/// <reference types="node" />

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AudioPort } from './controller/game-controller';
import type { GameEvent, GameSnapshot } from './game/types';
import type { RendererPort } from './render/game-renderer';
import {
  availableStorage,
  bootstrapGame,
  createAudioContext,
} from './bootstrap';
import type {
  BootstrapRuntime,
  ControllerRuntime,
} from './bootstrap';

class FakeRenderer implements RendererPort {
  readonly init = vi.fn<() => Promise<void>>(() => Promise.resolve());
  destroyCalls = 0;

  render(): void {}
  handleEvents(_events: readonly GameEvent[]): void {}
  setPaused(): void {}
  reset(_snapshot: GameSnapshot): void {}
  destroy(): void {
    this.destroyCalls += 1;
  }
}

class FakeController implements ControllerRuntime {
  startCalls = 0;
  destroyCalls = 0;
  toggleMuteCalls = 0;

  start(): void {
    this.startCalls += 1;
  }
  destroy(): void {
    this.destroyCalls += 1;
  }
  toggleMute(): void {
    this.toggleMuteCalls += 1;
  }
}

const runtimes: BootstrapRuntime[] = [];
const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const heightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');

function createRoot(): HTMLDivElement {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

async function startWithFakes(options: {
  readonly renderer?: FakeRenderer;
  readonly controller?: FakeController;
  readonly reload?: () => void;
} = {}): Promise<{
  readonly root: HTMLDivElement;
  readonly renderer: FakeRenderer;
  readonly controller: FakeController;
  readonly controllerFactory: ReturnType<typeof vi.fn<() => FakeController>>;
  readonly runtime: BootstrapRuntime;
}> {
  const root = createRoot();
  const renderer = options.renderer ?? new FakeRenderer();
  const controller = options.controller ?? new FakeController();
  const controllerFactory = vi.fn(() => controller);
  const runtime = await bootstrapGame({
    window,
    document,
    root,
    storage: null,
    rendererFactory: () => renderer,
    controllerFactory,
    reload: options.reload,
  });
  runtimes.push(runtime);
  return { root, renderer, controller, controllerFactory, runtime };
}

function expectRendererError(root: HTMLElement): HTMLButtonElement {
  expect(root.querySelector('.game-overlay h2')?.textContent).toBe('无法启动 WebGL');
  expect(root.querySelector('.game-overlay__detail')?.textContent).toBe(
    '请开启浏览器硬件加速后刷新页面。',
  );
  const retry = root.querySelector<HTMLButtonElement>('[data-testid="retry"]');
  expect(retry?.textContent).toBe('重新尝试');
  if (!retry) {
    throw new Error('错误页缺少重试按钮');
  }
  return retry;
}

afterEach(() => {
  for (const runtime of runtimes.splice(0)) {
    runtime.cleanup();
  }
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (widthDescriptor) {
    Object.defineProperty(window, 'innerWidth', widthDescriptor);
  }
  if (heightDescriptor) {
    Object.defineProperty(window, 'innerHeight', heightDescriptor);
  }
});

describe('启动流程', () => {
  it('渲染器初始化失败时不启动控制器并显示精确错误，重试会刷新', async () => {
    vi.useFakeTimers();
    const renderer = new FakeRenderer();
    renderer.init.mockRejectedValueOnce(new Error('WebGL 初始化失败'));
    const reload = vi.fn();

    const addWindowListener = vi.spyOn(window, 'addEventListener');
    const { root, controller, controllerFactory } = await startWithFakes({
      renderer,
      reload,
    });

    expect(controller.startCalls).toBe(0);
    expect(controllerFactory).not.toHaveBeenCalled();
    expect(renderer.destroyCalls).toBe(1);
    expect(addWindowListener).not.toHaveBeenCalledWith('resize', expect.any(Function));
    expect(addWindowListener).not.toHaveBeenCalledWith('beforeunload', expect.any(Function));
    const host = root.querySelector<HTMLElement>('[data-testid="canvas-host"]');
    const speed = root.querySelector<HTMLElement>('[data-testid="speed"]');
    host?.dispatchEvent(new Event('snake:speed-pulse'));
    expect(speed?.classList.contains('is-pulsing')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    const retry = expectRendererError(root);
    retry.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('渲染器工厂抛错时启动流程仍 resolve 并保留可清理的错误页', async () => {
    const root = createRoot();
    const reload = vi.fn();
    const controllerFactory = vi.fn(() => new FakeController());

    const runtimePromise = bootstrapGame({
      window,
      document,
      root,
      storage: null,
      rendererFactory: () => {
        throw new Error('渲染器构造失败');
      },
      controllerFactory,
      reload,
    });

    await expect(runtimePromise).resolves.toBeDefined();
    const runtime = await runtimePromise;
    runtimes.push(runtime);
    expect(controllerFactory).not.toHaveBeenCalled();
    const retry = expectRendererError(root);

    runtime.cleanup();
    retry.click();
    expect(reload).not.toHaveBeenCalled();
    expect(root.querySelector('[data-testid="retry"]')).toBeNull();
  });

  it('控制器工厂抛错时销毁已初始化渲染器一次并显示错误页', async () => {
    const root = createRoot();
    const renderer = new FakeRenderer();
    const controllerFactory = vi.fn((): FakeController => {
      throw new Error('控制器构造失败');
    });

    const runtimePromise = bootstrapGame({
      window,
      document,
      root,
      storage: null,
      rendererFactory: () => renderer,
      controllerFactory,
    });

    await expect(runtimePromise).resolves.toBeDefined();
    const runtime = await runtimePromise;
    runtimes.push(runtime);
    expect(renderer.init).toHaveBeenCalledTimes(1);
    expect(renderer.destroyCalls).toBe(1);
    expectRendererError(root);

    runtime.cleanup();
    expect(renderer.destroyCalls).toBe(1);
  });

  it('默认渲染器加载失败时不构造控制器并显示错误页', async () => {
    const root = createRoot();
    const rendererLoader = vi.fn(async (): Promise<RendererPort> => {
      throw new Error('动态导入失败');
    });
    const controllerFactory = vi.fn(() => new FakeController());

    const runtimePromise = bootstrapGame({
      window,
      document,
      root,
      storage: null,
      rendererLoader,
      controllerFactory,
    });

    await expect(runtimePromise).resolves.toBeDefined();
    const runtime = await runtimePromise;
    runtimes.push(runtime);
    expect(rendererLoader).toHaveBeenCalledWith(
      root.querySelector('[data-testid="canvas-host"]'),
    );
    expect(controllerFactory).not.toHaveBeenCalled();
    expectRendererError(root);
  });

  it('渲染器初始化成功后只启动控制器一次', async () => {
    const { renderer, controller, controllerFactory } = await startWithFakes();

    expect(renderer.init).toHaveBeenCalledTimes(1);
    expect(controllerFactory).toHaveBeenCalledTimes(1);
    expect(controller.startCalls).toBe(1);
  });

  it('初始小视口显示提示并在尺寸恢复后隐藏', async () => {
    setViewport(639, 800);
    const { root } = await startWithFakes();
    const hint = root.querySelector<HTMLElement>('[data-testid="viewport-hint"]');

    expect(hint?.hidden).toBe(false);
    setViewport(700, 519);
    window.dispatchEvent(new Event('resize'));
    expect(hint?.hidden).toBe(false);
    setViewport(700, 600);
    window.dispatchEvent(new Event('resize'));
    expect(hint?.hidden).toBe(true);
  });

  it('速度事件触发 HUD 脉冲样式', async () => {
    const { root } = await startWithFakes();
    const host = root.querySelector<HTMLElement>('[data-testid="canvas-host"]');
    const speed = root.querySelector<HTMLElement>('[data-testid="speed"]');

    host?.dispatchEvent(new Event('snake:speed-pulse'));

    expect(speed?.classList.contains('is-pulsing')).toBe(true);
  });

  it('页面卸载和显式清理只销毁控制器一次', async () => {
    const { controller, runtime } = await startWithFakes();

    window.dispatchEvent(new Event('beforeunload'));
    runtime.cleanup();

    expect(controller.destroyCalls).toBe(1);
  });

  it('显式清理会移除 HUD 计时器和交互监听器且保持幂等', async () => {
    vi.useFakeTimers();
    setViewport(700, 600);
    const { root, controller, runtime } = await startWithFakes();
    const host = root.querySelector<HTMLElement>('[data-testid="canvas-host"]');
    const speed = root.querySelector<HTMLElement>('[data-testid="speed"]');
    const mute = root.querySelector<HTMLButtonElement>('[data-testid="mute"]');
    const hint = root.querySelector<HTMLElement>('[data-testid="viewport-hint"]');

    host?.dispatchEvent(new Event('snake:speed-pulse'));
    mute?.click();
    expect(speed?.classList.contains('is-pulsing')).toBe(true);
    expect(controller.toggleMuteCalls).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    runtime.cleanup();
    runtime.cleanup();
    expect(controller.destroyCalls).toBe(1);
    expect(speed?.classList.contains('is-pulsing')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    mute?.click();
    host?.dispatchEvent(new Event('snake:speed-pulse'));
    setViewport(500, 600);
    window.dispatchEvent(new Event('resize'));
    expect(controller.toggleMuteCalls).toBe(1);
    expect(speed?.classList.contains('is-pulsing')).toBe(false);
    expect(hint?.hidden).toBe(true);
  });
});

describe('安全降级 helper', () => {
  it('访问本地存储抛错时返回 null', () => {
    const target = Object.defineProperty({}, 'localStorage', {
      get: () => {
        throw new Error('存储被禁用');
      },
    });

    expect(availableStorage(target as Pick<Window, 'localStorage'>)).toBeNull();
  });

  it('缺少 AudioContext 时只在解锁调用时报错，不阻断启动', async () => {
    expect(() => createAudioContext({})).toThrow('当前浏览器不支持音频播放');
    const root = createRoot();
    const renderer = new FakeRenderer();
    const controller = new FakeController();
    let audio: AudioPort | undefined;

    const runtime = await bootstrapGame({
      window,
      document,
      root,
      storage: null,
      rendererFactory: () => renderer,
      controllerFactory: (dependencies) => {
        audio = dependencies.audio;
        return controller;
      },
    });
    runtimes.push(runtime);

    expect(controller.startCalls).toBe(1);
    await expect(audio?.unlock()).rejects.toThrow('当前浏览器不支持音频播放');
  });
});
