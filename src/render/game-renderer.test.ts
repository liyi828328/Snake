// 使用 Node 环境避免 jsdom 模拟画布产生无关警告。
// @vitest-environment node

import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';

import type { GameSnapshot } from '../game/types';
import {
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
    food: { x: 10, y: 8 },
    direction: 'right',
    status: 'playing',
    score: 0,
    foodCount: 0,
    tickMs: 120,
  };
}

describe('棋盘布局', () => {
  it('在普通屏幕内生成居中的 32×24 棋盘', () => {
    expect(calculateBoardLayout(1_200, 900)).toEqual({
      cell: 30,
      boardWidth: 960,
      boardHeight: 720,
      x: 120,
      y: 90,
    });
  });

  it('奇数和小数屏幕尺寸也使用整数坐标居中', () => {
    const layout = calculateBoardLayout(1_201.5, 901.5);

    expect(layout).toEqual({
      cell: 30,
      boardWidth: 960,
      boardHeight: 720,
      x: 120,
      y: 90,
    });
    expect(Number.isInteger(layout.x)).toBe(true);
    expect(Number.isInteger(layout.y)).toBe(true);
  });

  it('窄屏使用可完整容纳棋盘的小数格宽', () => {
    expect(calculateBoardLayout(238, 178.5)).toEqual({
      cell: 5.4375,
      boardWidth: 174,
      boardHeight: 130.5,
      x: 32,
      y: 24,
    });
  });

  it('极小或无效屏幕不产生失控坐标', () => {
    expect(calculateBoardLayout(20, 16)).toEqual({
      cell: 0,
      boardWidth: 0,
      boardHeight: 0,
      x: 10,
      y: 8,
    });

    const invalid = calculateBoardLayout(Number.NaN, Number.NEGATIVE_INFINITY);
    expect(Object.values(invalid).every(Number.isFinite)).toBe(true);
    expect(invalid.x).toBeGreaterThanOrEqual(0);
    expect(invalid.y).toBeGreaterThanOrEqual(0);
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
