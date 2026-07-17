/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameSnapshot, GameStatus } from '../game/types';
import { Hud } from './hud';

const styles = readFileSync('src/styles.css', 'utf8');

function snapshot(
  status: GameStatus = 'ready',
  overrides: Partial<GameSnapshot> = {},
): GameSnapshot {
  return {
    width: 40,
    height: 24,
    body: [{ x: 4, y: 4 }],
    foods: [{ x: 8, y: 8, kind: 'normal' }],
    direction: 'right',
    status,
    score: 0,
    foodCount: 0,
    tickMs: 150,
    ...overrides,
  };
}

function byTestId(root: HTMLElement, testId: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!element) {
    throw new Error(`找不到测试元素：${testId}`);
  }
  return element;
}

describe('HUD', () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });

  afterEach(() => {
    vi.useRealTimers();
    root.remove();
  });

  it('创建完整中文界面并公开画布宿主', () => {
    const hud = new Hud(root, vi.fn());

    expect(root.querySelector('main.game-shell')).not.toBeNull();
    const header = root.querySelector('header.hud');
    const scores = header?.querySelector('.hud__scores');
    const speedPanel = header?.querySelector('.hud__speed-panel');
    expect(header?.children).toHaveLength(3);
    expect(header?.children[0]).toBe(scores);
    expect(header?.children[1]?.classList.contains('hud__identity')).toBe(true);
    expect(header?.children[2]).toBe(speedPanel);
    expect(scores?.querySelector('[data-testid="score"]')).not.toBeNull();
    expect(scores?.querySelector('[data-testid="best-score"]')).not.toBeNull();
    expect(speedPanel?.querySelector('[data-testid="speed"]')).not.toBeNull();
    expect(speedPanel?.querySelector('[data-testid="score"]')).toBeNull();
    expect(speedPanel?.querySelector('[data-testid="best-score"]')).toBeNull();
    expect(header?.textContent).toContain('贪吃蛇 // 霓虹');
    expect(hud.canvasHost).toBe(byTestId(root, 'canvas-host'));
    const overlay = byTestId(root, 'overlay');
    expect(overlay.dataset.state).toBe('ready');
    expect(overlay.querySelector('.game-overlay__eyebrow')?.textContent).toBe('系统待命');
    expect(overlay.querySelector('h2')?.textContent).toBe('按空格键开始');
    expect(root.querySelector('footer')?.textContent).toContain(
      '方向键移动/空格键暂停/R重新开始/M静音',
    );
    expect(byTestId(root, 'mute').getAttribute('aria-label')).toBe('切换静音');
  });

  it('更新补零分数、最高分、速度与静音状态', () => {
    const hud = new Hud(root, vi.fn());

    hud.update(snapshot('ready', { score: 70, foodCount: 5 }), 123, true);

    expect(byTestId(root, 'score').textContent).toBe('00070');
    expect(byTestId(root, 'best-score').textContent).toBe('00123');
    expect(byTestId(root, 'speed').textContent).toBe('× 1.2');
    expect(byTestId(root, 'mute').textContent).toBe('声音：关');
    expect(byTestId(root, 'mute').getAttribute('aria-pressed')).toBe('true');

    hud.update(snapshot('ready'), 0, false);
    expect(byTestId(root, 'mute').textContent).toBe('声音：开');
    expect(byTestId(root, 'mute').getAttribute('aria-pressed')).toBe('false');
  });

  it('相同数据不写 DOM，单字段变化只更新对应元素', () => {
    const hud = new Hud(root, vi.fn());
    const current = snapshot('paused', { score: 70, foodCount: 5 });
    hud.update(current, 123, true);
    const observer = new MutationObserver(() => undefined);
    observer.observe(root, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });

    hud.update(current, 123, true);
    expect(observer.takeRecords()).toEqual([]);

    hud.update(current, 124, true);
    const targets = observer.takeRecords().map((record) => record.target);
    expect(targets).toEqual([byTestId(root, 'best-score')]);
    observer.disconnect();
  });

  it.each([
    ['ready', '系统待命', '按空格键开始', '穿过霓虹网格'],
    ['paused', '信号冻结', '已暂停', '按空格键继续'],
    ['gameOver', '连接中断', '系统中断', '按 R 重新开始'],
    ['completed', '全域点亮', '棋盘已占满', '按 R 再来一局'],
  ] as const)('为 %s 显示对应覆盖层', (status, eyebrow, title, detail) => {
    const hud = new Hud(root, vi.fn());

    hud.update(snapshot(status), 0, false);

    const overlay = byTestId(root, 'overlay');
    expect(overlay.hidden).toBe(false);
    expect(overlay.dataset.state).toBe(status);
    expect(overlay.querySelector('.game-overlay__eyebrow')?.textContent).toBe(eyebrow);
    expect(overlay.querySelector('h2')?.textContent).toBe(title);
    expect(overlay.querySelector('.game-overlay__detail')?.textContent).toContain(detail);
  });

  it('游戏中隐藏覆盖层', () => {
    const hud = new Hud(root, vi.fn());

    hud.update(snapshot('playing'), 0, false);

    const overlay = byTestId(root, 'overlay');
    expect(overlay.hidden).toBe(true);
    expect(overlay.dataset.state).toBe('playing');
  });

  it('静音按钮触发回调且销毁后解除监听', () => {
    const onToggleMute = vi.fn();
    const hud = new Hud(root, onToggleMute);
    const button = byTestId(root, 'mute');

    button.click();
    expect(onToggleMute).toHaveBeenCalledTimes(1);

    hud.destroy();
    button.click();
    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it('显示渲染错误并确保重试回调只执行一次', () => {
    const onRetry = vi.fn();
    const hud = new Hud(root, vi.fn());

    hud.showRendererError(onRetry);

    const overlay = byTestId(root, 'overlay');
    const retry = byTestId(root, 'retry') as HTMLButtonElement;
    expect(overlay.hidden).toBe(false);
    expect(overlay.querySelector('h2')?.textContent).toBe('无法启动 WebGL');
    expect(overlay.querySelector('.game-overlay__detail')?.textContent).toBe(
      '请开启浏览器硬件加速后刷新页面。',
    );
    expect(retry.textContent).toBe('重新尝试');

    retry.click();
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('使用 HUD 所属 Document 创建渲染错误重试按钮', () => {
    const ownerDocument = document.implementation.createHTMLDocument('HUD');
    const foreignRoot = ownerDocument.createElement('div');
    const hud = new Hud(foreignRoot, vi.fn());
    const globalCreateElement = vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('不应使用全局 document');
    });

    try {
      expect(() => hud.showRendererError(vi.fn())).not.toThrow();
      const retry = foreignRoot.querySelector<HTMLButtonElement>('[data-testid="retry"]');
      expect(retry?.ownerDocument).toBe(ownerDocument);
    } finally {
      globalCreateElement.mockRestore();
      hud.destroy();
    }
  });

  it('移动端隐藏标识后保留完整分数列和独立速度列且不撑高游戏区', () => {
    expect(styles).toContain(
      'grid-template-columns: minmax(280px, 1fr) auto minmax(100px, 1fr)',
    );
    expect(styles).toContain(
      'grid-template-columns: minmax(170px, 1fr) minmax(66px, auto)',
    );
    expect(styles).toMatch(/\.hud__identity\s*\{\s*display:\s*none;/);
    expect(styles).not.toMatch(/\.arena\s*\{[^}]*min-height:/s);
  });

  it('游戏框宽度同时受 vh 与 dvh 高度限制并在矮视口压缩 HUD 和页脚', () => {
    expect(styles).toContain(
      'width: min(1100px, 100%, max(240px, calc(133.333vh - 346.667px)));',
    );
    expect(styles).toContain(
      'width: min(1100px, 100%, max(240px, calc(133.333dvh - 346.667px)));',
    );
    expect(styles).toMatch(
      /@media \(max-height: 760px\)\s*\{[\s\S]*?\.hud\s*\{[^}]*min-height:[^}]*padding:[^}]*\}[\s\S]*?\.game-footer\s*\{[^}]*min-height:[^}]*padding:/,
    );
  });

  it('控制小屏提示显示状态', () => {
    const hud = new Hud(root, vi.fn());

    hud.showSmallViewportHint(true);
    expect(byTestId(root, 'viewport-hint').hidden).toBe(false);
    expect(byTestId(root, 'viewport-hint').textContent).toContain(
      '建议使用桌面端获得完整体验',
    );

    hud.showSmallViewportHint(false);
    expect(byTestId(root, 'viewport-hint').hidden).toBe(true);
  });

  it('速度脉冲重复触发时重置计时且销毁会清理', () => {
    vi.useFakeTimers();
    const hud = new Hud(root, vi.fn());
    const speed = byTestId(root, 'speed');

    hud.pulseSpeed();
    expect(speed.classList.contains('is-pulsing')).toBe(true);

    vi.advanceTimersByTime(180);
    hud.pulseSpeed();
    vi.advanceTimersByTime(180);
    expect(speed.classList.contains('is-pulsing')).toBe(true);

    hud.destroy();
    expect(speed.classList.contains('is-pulsing')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
