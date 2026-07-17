// 使用 Node 环境避免 jsdom 模拟画布产生无关警告。
// @vitest-environment node

import { Container } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';

import type { GameSnapshot } from '../game/types';
import {
  GameRenderer,
  calculateBoardLayout,
  interpolateBody,
  interpolatePointInto,
} from './game-renderer';
import { ParticlePool } from './particles';

function snapshot(body: GameSnapshot['body']): GameSnapshot {
  return {
    width: 32,
    height: 24,
    body,
    foods: [{ x: 10, y: 8, kind: 'normal' }],
    direction: 'right',
    status: 'playing',
    score: 0,
    foodCount: 0,
    tickMs: 120,
  };
}

describe('棋盘布局', () => {
  it('在 1280×768 屏幕内生成居中的 40×24 棋盘', () => {
    expect(calculateBoardLayout(1_280, 768, 40, 24)).toEqual({
      cell: 30,
      boardWidth: 1_200,
      boardHeight: 720,
      x: 40,
      y: 24,
    });
  });

  it('自定义 14×10 棋盘仍限制最大格宽并居中', () => {
    expect(calculateBoardLayout(800, 600, 14, 10)).toEqual({
      cell: 30,
      boardWidth: 420,
      boardHeight: 300,
      x: 190,
      y: 150,
    });
  });

  it('320×192 屏幕保留四边 24px 间距', () => {
    expect(calculateBoardLayout(320, 192, 40, 24)).toEqual({
      cell: 6,
      boardWidth: 240,
      boardHeight: 144,
      x: 40,
      y: 24,
    });
  });

  it('极小、极端或无效输入保持有限非负并回退默认棋盘尺寸', () => {
    expect(calculateBoardLayout(20, 16, 0, Number.NaN)).toEqual({
      cell: 0,
      boardWidth: 0,
      boardHeight: 0,
      x: 10,
      y: 8,
    });

    for (const layout of [
      calculateBoardLayout(Number.NaN, Number.NEGATIVE_INFINITY, -1, 0),
      calculateBoardLayout(Number.MAX_VALUE, Number.MAX_VALUE, 1, 1),
      calculateBoardLayout(-Number.MAX_VALUE, -Number.MAX_VALUE, 40, 24),
    ]) {
      expect(Object.values(layout).every(Number.isFinite)).toBe(true);
      expect(Object.values(layout).every((value) => value >= 0)).toBe(true);
    }
  });
});

describe('渲染器棋盘尺寸', () => {
  it('以默认 40×24 初始化并在同屏幕切换自定义尺寸时重算布局', () => {
    const renderer = new GameRenderer({} as HTMLElement);
    const redrawBoardAndGrid = vi.fn();
    const internals = renderer as unknown as {
      app: { screen: { width: number; height: number } };
      boardColumns: number;
      boardRows: number;
      layout: ReturnType<typeof calculateBoardLayout> | null;
      ensureLayout(columns?: number, rows?: number): void;
      redrawBackground(): void;
      redrawBoardAndGrid(): void;
      redrawFoodGeometry(): void;
      redrawImpactGeometry(): void;
      redrawSegmentGeometry(): void;
    };
    internals.app = { screen: { width: 800, height: 600 } };
    internals.redrawBackground = vi.fn();
    internals.redrawBoardAndGrid = redrawBoardAndGrid;
    internals.redrawFoodGeometry = vi.fn();
    internals.redrawImpactGeometry = vi.fn();
    internals.redrawSegmentGeometry = vi.fn();

    expect([internals.boardColumns, internals.boardRows]).toEqual([40, 24]);
    internals.ensureLayout(14, 10);
    expect(internals.layout).toEqual(calculateBoardLayout(800, 600, 14, 10));
    expect([internals.boardColumns, internals.boardRows]).toEqual([14, 10]);

    internals.ensureLayout();
    expect(redrawBoardAndGrid).toHaveBeenCalledTimes(1);
    internals.ensureLayout(20, 12);
    expect(redrawBoardAndGrid).toHaveBeenCalledTimes(2);
  });

  it('render 使用当前快照尺寸更新布局', () => {
    const renderer = new GameRenderer({} as HTMLElement);
    const ensureLayout = vi.fn();
    const internals = renderer as unknown as {
      app: { render(): void };
      ensureLayout(columns?: number, rows?: number): void;
      applyQuality(): void;
      drawSnake(): void;
      drawFoods(): void;
      drawEffects(): void;
    };
    internals.app = { render: vi.fn() };
    internals.ensureLayout = ensureLayout;
    internals.applyQuality = vi.fn();
    internals.drawSnake = vi.fn();
    internals.drawFoods = vi.fn();
    internals.drawEffects = vi.fn();
    const current = { ...snapshot([{ x: 2, y: 2 }]), width: 14, height: 10 };

    renderer.render(current, current, 1, 0);

    expect(ensureLayout).toHaveBeenCalledWith(14, 10);
  });
});

describe('蛇身插值', () => {
  it('写入并返回调用方提供的坐标对象', () => {
    const target = { x: -1, y: -1 };

    const result = interpolatePointInto(
      { x: 2, y: 3 },
      { x: 4, y: 7 },
      0.5,
      target,
    );

    expect(result).toBe(target);
    expect(target).toEqual({ x: 3, y: 5 });
  });

  it('夹取插值比例并为每一节返回独立坐标', () => {
    const previous = snapshot([{ x: 2, y: 3 }]);
    const current = snapshot([{ x: 4, y: 7 }]);

    expect(interpolateBody(previous, current, -1)).toEqual([{ x: 2, y: 3 }]);
    const end = interpolateBody(previous, current, 2);
    expect(end).toEqual([{ x: 4, y: 7 }]);
    expect(end[0]).not.toBe(current.body[0]);
  });

  it('新增尾节从上一快照最后一节开始插值', () => {
    const previous = snapshot([
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ]);
    const current = snapshot([
      { x: 3, y: 2 },
      { x: 2, y: 2 },
      { x: 1, y: 2 },
    ]);

    expect(interpolateBody(previous, current, 0.5)).toEqual([
      { x: 2.5, y: 2 },
      { x: 1.5, y: 2 },
      { x: 1, y: 2 },
    ]);
  });
});

describe('粒子池', () => {
  it('预创建图形并只激活质量上限内的空闲粒子', () => {
    const parent = new Container();
    const pool = new ParticlePool(parent, 4);

    expect(parent.children).toHaveLength(4);
    expect(parent.children.every((child) => !child.visible)).toBe(true);

    pool.setLimit(2);
    pool.burst({ x: 12, y: 18, color: 0x45f4ff, count: 4 });
    expect(parent.children.filter((child) => child.visible)).toHaveLength(2);

    pool.destroy();
  });

  it('降低上限关闭超出范围的活跃粒子且 clear 隐藏全部粒子', () => {
    const parent = new Container();
    const pool = new ParticlePool(parent, 4);

    pool.burst({ x: 12, y: 18, color: 0xe45bff, count: 4 });
    pool.setLimit(1);
    expect(parent.children.filter((child) => child.visible)).toHaveLength(1);

    pool.clear();
    expect(parent.children.every((child) => !child.visible)).toBe(true);

    pool.destroy();
  });

  it('忽略非正更新时间并在寿命结束后回收粒子', () => {
    const parent = new Container();
    const pool = new ParticlePool(parent, 1);

    pool.burst({ x: 12, y: 18, color: 0xf1ffff, count: 1 });
    const particle = parent.children[0]!;
    const initial = { x: particle.x, y: particle.y, alpha: particle.alpha };

    pool.update(0);
    pool.update(-16);
    expect({ x: particle.x, y: particle.y, alpha: particle.alpha }).toEqual(initial);

    pool.update(1);
    pool.update(100_000);
    expect(particle.visible).toBe(false);

    pool.destroy();
  });

  it('雨粒子首帧保持初始位置且随后向下移动', () => {
    const parent = new Container();
    let randomCalls = 0;
    const pool = new ParticlePool(parent, 1, () => {
      randomCalls += 1;
      return 0.75;
    });

    pool.burst({
      x: 12,
      y: 18,
      color: 0x45f4ff,
      count: 1,
      mode: 'rain',
    });
    const particle = parent.children[0]!;
    const initial = { x: particle.x, y: particle.y, alpha: particle.alpha };

    pool.update(100);
    expect({ x: particle.x, y: particle.y, alpha: particle.alpha }).toEqual(initial);
    pool.update(100);
    expect(particle.y).toBeGreaterThan(initial.y);
    expect(randomCalls).toBeGreaterThan(0);

    pool.destroy();
  });

  it('完成雨替换已占满的旧粒子且不超过当前上限', () => {
    const parent = new Container();
    const pool = new ParticlePool(parent, 4, () => 0.5);
    pool.setLimit(2);
    pool.burst({ x: 12, y: 18, color: 0xf1ffff, count: 2 });

    pool.replaceBursts([
      { x: 20, y: -5, color: 0x45f4ff, count: 1, mode: 'rain' },
      { x: 30, y: -5, color: 0xe45bff, count: 1, mode: 'rain' },
      { x: 40, y: -5, color: 0x45f4ff, count: 1, mode: 'rain' },
    ]);

    const visible = parent.children.filter((child) => child.visible);
    expect(visible).toHaveLength(2);
    expect(visible.map((child) => child.y)).toEqual([-5, -5]);

    pool.destroy();
  });
});
