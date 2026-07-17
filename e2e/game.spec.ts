/// <reference lib="dom" />

import { chromium, expect, test, type Page } from '@playwright/test';

const STORAGE_KEY = 'neon-snake-preferences-v1';

interface CanvasSample {
  readonly colorCount: number;
  readonly luminanceRange: number;
  readonly nonTransparentRatio: number;
}

interface RenderedBoardEdges {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly vertical: readonly number[];
  readonly horizontal: readonly number[];
}

async function expectGameReady(page: Page): Promise<void> {
  const overlay = page.getByTestId('overlay');
  const canvas = page.getByTestId('canvas-host').locator('canvas');

  await expect(canvas).toBeVisible();
  await expect(overlay).toHaveAttribute('data-state', 'ready');
  await expect(overlay).toBeVisible();
}

async function sampleCanvas(page: Page): Promise<CanvasSample> {
  return page
    .getByTestId('canvas-host')
    .locator('canvas')
    .evaluate(async (element) => {
      const source = element as HTMLCanvasElement;
      window.dispatchEvent(new Event('resize'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const context = source.getContext('webgl2') ?? source.getContext('webgl');
      if (!context) {
        throw new Error('无法读取 WebGL 画布上下文');
      }
      const width = context.drawingBufferWidth;
      const height = context.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      context.readPixels(
        0,
        0,
        width,
        height,
        context.RGBA,
        context.UNSIGNED_BYTE,
        pixels,
      );
      const colors = new Set<number>();
      let nonTransparent = 0;
      let minimumLuminance = 255;
      let maximumLuminance = 0;

      for (let index = 0; index < pixels.length; index += 16) {
        const red = pixels[index]!;
        const green = pixels[index + 1]!;
        const blue = pixels[index + 2]!;
        const alpha = pixels[index + 3]!;
        if (alpha === 0) {
          continue;
        }
        nonTransparent += 1;
        const luminance = (red * 299 + green * 587 + blue * 114) / 1_000;
        minimumLuminance = Math.min(minimumLuminance, luminance);
        maximumLuminance = Math.max(maximumLuminance, luminance);
        // 降低抗锯齿细微差异的影响，只统计每通道高四位。
        colors.add(
          ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4),
        );
      }

      return {
        colorCount: colors.size,
        luminanceRange: maximumLuminance - minimumLuminance,
        nonTransparentRatio: nonTransparent / (pixels.length / 16),
      };
    });
}

async function findRenderedBoardEdges(
  page: Page,
  redraw: 'resize' | 'visibility' = 'resize',
): Promise<RenderedBoardEdges> {
  return page
    .getByTestId('canvas-host')
    .locator('canvas')
    .evaluate(async (element, redrawMode) => {
      const source = element as HTMLCanvasElement;
      if (redrawMode === 'visibility') {
        Object.defineProperties(document, {
          hidden: { configurable: true, get: () => false },
          visibilityState: { configurable: true, get: () => 'visible' },
        });
        document.dispatchEvent(new Event('visibilitychange'));
      } else {
        window.dispatchEvent(new Event('resize'));
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const context = source.getContext('webgl2') ?? source.getContext('webgl');
      if (!context) {
        throw new Error('无法读取 WebGL 画布上下文');
      }
      const canvasWidth = context.drawingBufferWidth;
      const canvasHeight = context.drawingBufferHeight;
      const pixels = new Uint8Array(canvasWidth * canvasHeight * 4);
      context.readPixels(
        0,
        0,
        canvasWidth,
        canvasHeight,
        context.RGBA,
        context.UNSIGNED_BYTE,
        pixels,
      );
      const verticalCounts = Array<number>(canvasWidth).fill(0);
      const horizontalCounts = Array<number>(canvasHeight).fill(0);

      for (let y = 0; y < canvasHeight; y += 1) {
        for (let x = 0; x < canvasWidth; x += 1) {
          const offset = (y * canvasWidth + x) * 4;
          const red = pixels[offset]!;
          const green = pixels[offset + 1]!;
          const blue = pixels[offset + 2]!;
          const isBoardEdge = red >= 8 && red <= 14
            && green >= 34 && green <= 56
            && blue >= 48 && blue <= 78;
          if (isBoardEdge) {
            verticalCounts[x]! += 1;
            horizontalCounts[y]! += 1;
          }
        }
      }

      return {
        canvasWidth,
        canvasHeight,
        vertical: verticalCounts
          .map((count, position) => ({ count, position }))
          .filter(({ count }) => count > canvasHeight * 0.4)
          .map(({ position }) => position),
        horizontal: horizontalCounts
          .map((count, position) => ({ count, position }))
          .filter(({ count }) => count > canvasWidth / 2)
          .map(({ position }) => position),
      };
    }, redraw);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
  await expectGameReady(page);
});

test('WebGL 游戏以待命状态启动并输出非空多色画面', async ({ page }) => {
  await expect(page.getByTestId('overlay')).not.toHaveAttribute(
    'data-state',
    'rendererError',
  );
  await expect
    .poll(async () => (await sampleCanvas(page)).colorCount)
    .toBeGreaterThan(3);
  const sample = await sampleCanvas(page);
  expect(sample.nonTransparentRatio).toBeGreaterThan(0.5);
  expect(sample.luminanceRange).toBeGreaterThan(10);
});

test('禁用 WebGL、WebGPU 和 GPU 时显示渲染器错误页', async ({ page }) => {
  const browser = await chromium.launch({
    args: ['--disable-webgl', '--disable-webgpu', '--disable-gpu'],
  });
  const disabledPage = await browser.newPage();

  try {
    await disabledPage.goto(new URL('/', page.url()).href);
    const overlay = disabledPage.getByTestId('overlay');

    await expect(overlay).toHaveAttribute('data-state', 'rendererError');
    await expect(overlay.getByText('渲染器不可用')).toBeVisible();
    await expect(overlay.getByText('无法启动 WebGL')).toBeVisible();
    await expect(overlay.getByRole('button', { name: '重新尝试' })).toBeVisible();
    await expect(disabledPage.getByTestId('canvas-host').locator('canvas')).toHaveCount(0);
  } finally {
    await browser.close();
  }
});

test('键盘可开始、转向、暂停和重新待命', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.clock.install();
  await page.reload();
  await expectGameReady(page);
  const currentTime = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(currentTime + 1_000);
  const overlay = page.getByTestId('overlay');

  await page.keyboard.press('Space');
  await expect(overlay).toHaveAttribute('data-state', 'playing');
  await expect(overlay).toBeHidden();

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'w',
      code: 'KeyW',
      bubbles: true,
    }));
  });
  // 初始向右至少可走 15 步；若 W 被错误映射为向上，第 13 步就会撞墙。
  await page.clock.runFor(2_200);
  await expect(overlay).toHaveAttribute('data-state', 'playing');
  expect(pageErrors).toEqual([]);

  await page.keyboard.press('ArrowUp');
  // 此时已接近右墙；方向键无效会继续向右撞墙，成功转向则仍在游戏。
  await page.clock.runFor(400);
  await expect(overlay).toHaveAttribute('data-state', 'playing');

  await page.keyboard.press('Space');
  await expect(overlay).toHaveAttribute('data-state', 'paused');
  await expect(overlay).toBeVisible();

  await page.keyboard.press('Space');
  await expect(overlay).toHaveAttribute('data-state', 'playing');
  await expect(overlay).toBeHidden();

  await page.keyboard.press('Space');
  await expect(overlay).toHaveAttribute('data-state', 'paused');
  await page.keyboard.press('KeyR');
  await expect(overlay).toHaveAttribute('data-state', 'ready');
});

test('静音选择在刷新后保持', async ({ page }) => {
  const mute = page.getByTestId('mute');

  await page.keyboard.press('KeyM');
  await expect(mute).toHaveText('声音：关');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.getByTestId('canvas-host').locator('canvas')).toBeVisible();
  await expect(mute).toHaveText('声音：关');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');

  await mute.click();
  await expect(mute).toHaveText('声音：开');
  await expect(mute).toHaveAttribute('aria-pressed', 'false');

  await mute.click();
  await expect(mute).toHaveText('声音：关');
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
});

test('从本地存储恢复最高分', async ({ page }) => {
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ bestScore: 120, muted: false }));
  }, STORAGE_KEY);

  await page.reload();
  await expect(page.getByTestId('best-score')).toHaveText('00120');
});

test('页面隐藏时自动暂停且恢复可见后保持暂停', async ({ page }) => {
  const overlay = page.getByTestId('overlay');
  await page.keyboard.press('Space');
  await expect(overlay).toHaveAttribute('data-state', 'playing');

  await page.evaluate(() => {
    Object.defineProperties(document, {
      hidden: { configurable: true, get: () => true },
      visibilityState: { configurable: true, get: () => 'hidden' },
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(overlay).toHaveAttribute('data-state', 'paused');

  await page.evaluate(() => {
    Object.defineProperties(document, {
      hidden: { configurable: true, get: () => false },
      visibilityState: { configurable: true, get: () => 'visible' },
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(overlay).toHaveAttribute('data-state', 'paused');
});

test('窗口失焦时自动暂停', async ({ page }) => {
  const overlay = page.getByTestId('overlay');
  await page.keyboard.press('Space');
  await expect(overlay).toHaveAttribute('data-state', 'playing');

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(overlay).toHaveAttribute('data-state', 'paused');
  await expect(overlay).toBeVisible();
});

test('常见视口保持画布、提示阈值和 5:3 布局', async ({ page }) => {
  const canvas = page.getByTestId('canvas-host').locator('canvas');
  const hint = page.getByTestId('viewport-hint');
  const viewports = [
    { width: 1440, height: 900, hintVisible: false },
    { width: 1024, height: 768, hintVisible: false },
    { width: 640, height: 520, hintVisible: false },
    { width: 639, height: 519, hintVisible: true },
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(canvas).toBeVisible();
    if (viewport.hintVisible) {
      await expect(hint).toBeVisible();
    } else {
      await expect(hint).toBeHidden();
    }
  }

  await page.setViewportSize({ width: 1366, height: 768 });
  const shellBox = await page.locator('.game-shell').boundingBox();
  const arenaBox = await page.locator('.arena').boundingBox();
  await expect(page.locator('.hud__identity')).toBeVisible();
  const hudLayout = await page.evaluate(() => {
    const hud = document.querySelector<HTMLElement>('.hud')!;
    const hudBox = hud.getBoundingClientRect();
    const items = ['score', 'best-score', 'speed'].map((testId) => {
      const box = document
        .querySelector<HTMLElement>(`[data-testid="${testId}"]`)!
        .getBoundingClientRect();
      return {
        testId,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
      };
    });
    return {
      clientWidth: hud.clientWidth,
      scrollWidth: hud.scrollWidth,
      hud: {
        top: hudBox.top,
        right: hudBox.right,
        bottom: hudBox.bottom,
        left: hudBox.left,
      },
      items,
    };
  });
  expect(shellBox).not.toBeNull();
  expect(arenaBox).not.toBeNull();
  expect(shellBox!.y + shellBox!.height).toBeLessThanOrEqual(769);
  expect(arenaBox!.width / arenaBox!.height).toBeCloseTo(5 / 3, 2);
  expect(hudLayout.scrollWidth).toBeLessThanOrEqual(hudLayout.clientWidth + 1);
  for (const item of hudLayout.items) {
    expect(item.left, `${item.testId} 左边界`).toBeGreaterThanOrEqual(
      hudLayout.hud.left - 1,
    );
    expect(item.right, `${item.testId} 右边界`).toBeLessThanOrEqual(
      hudLayout.hud.right + 1,
    );
    expect(item.top, `${item.testId} 上边界`).toBeGreaterThanOrEqual(
      hudLayout.hud.top - 1,
    );
    expect(item.bottom, `${item.testId} 下边界`).toBeLessThanOrEqual(
      hudLayout.hud.bottom + 1,
    );
  }
});

test('320×400 视口完整显示 5:3 棋盘、小屏提示且不纵向滚动', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 400 });
  const hint = page.getByTestId('viewport-hint');
  const host = page.getByTestId('canvas-host');

  await expect(hint).toBeVisible();
  await expect(host.locator('canvas')).toBeVisible();

  const board = await findRenderedBoardEdges(page);
  expect(board.vertical.length).toBeGreaterThanOrEqual(2);
  expect(board.horizontal.length).toBeGreaterThanOrEqual(2);
  const left = Math.min(...board.vertical);
  const right = Math.max(...board.vertical);
  const bottom = Math.min(...board.horizontal);
  const top = Math.max(...board.horizontal);
  expect(left).toBeGreaterThan(0);
  expect(right).toBeLessThan(board.canvasWidth - 1);
  expect(bottom).toBeGreaterThan(0);
  expect(top).toBeLessThan(board.canvasHeight - 1);
  expect((right - left) / (top - bottom)).toBeCloseTo(5 / 3, 1);

  const layout = await page.evaluate(() => {
    const hostBox = document
      .querySelector<HTMLElement>('[data-testid="canvas-host"]')!
      .getBoundingClientRect();
    return {
      hostRatio: hostBox.width / hostBox.height,
      viewportHeight: document.documentElement.clientHeight,
      pageHeight: document.documentElement.scrollHeight,
    };
  });
  expect(layout.hostRatio).toBeCloseTo(5 / 3, 2);
  expect(layout.pageHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
});

test('页面隐藏期间缩至 320×400 后恢复可见会重绘完整棋盘', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await findRenderedBoardEdges(page);
  await page.evaluate(() => {
    Object.defineProperties(document, {
      hidden: { configurable: true, get: () => true },
      visibilityState: { configurable: true, get: () => 'hidden' },
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await page.setViewportSize({ width: 320, height: 400 });
  const board = await findRenderedBoardEdges(page, 'visibility');
  expect(board.vertical.length).toBeGreaterThanOrEqual(2);
  expect(board.horizontal.length).toBeGreaterThanOrEqual(2);
  expect(Math.min(...board.vertical)).toBeGreaterThan(0);
  expect(Math.max(...board.vertical)).toBeLessThan(board.canvasWidth - 1);
  expect(Math.min(...board.horizontal)).toBeGreaterThan(0);
  expect(Math.max(...board.horizontal)).toBeLessThan(board.canvasHeight - 1);
});

test('自然撞墙后可重新待命', async ({ page }) => {
  const overlay = page.getByTestId('overlay');
  await page.keyboard.press('Space');
  await expect(overlay).toHaveAttribute('data-state', 'playing');
  await expect(overlay).toHaveAttribute('data-state', 'gameOver', {
    timeout: 8_000,
  });

  await page.keyboard.press('KeyR');
  await expect(overlay).toHaveAttribute('data-state', 'ready');
});

test('减少动态效果时仍可启动且不存在无限动画', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expectGameReady(page);

  const animation = await page.evaluate(() => {
    const style = getComputedStyle(document.body, '::before');
    return {
      duration: style.animationDuration,
      iterationCount: style.animationIterationCount,
    };
  });
  const durationSeconds = animation.duration.endsWith('ms')
    ? Number.parseFloat(animation.duration) / 1_000
    : Number.parseFloat(animation.duration);

  expect(animation.iterationCount).not.toContain('infinite');
  expect(durationSeconds).toBeLessThanOrEqual(0.000_02);
});
