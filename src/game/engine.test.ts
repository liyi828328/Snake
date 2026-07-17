import { describe, expect, it } from 'vitest';

import {
  BONUS_FOOD_LIFETIME_MS,
  BONUS_FOOD_MAX,
  BONUS_FOOD_MAX_INTERVAL_MS,
  BONUS_FOOD_MIN,
  BONUS_FOOD_MIN_INTERVAL_MS,
  BONUS_SCORE_PER_FOOD,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  NORMAL_FOOD_TARGET,
  SCORE_PER_FOOD,
  tickMsForFoodCount,
} from './config';
import { SnakeEngine } from './engine';
import { spawnFood } from './food';
import type { FoodSpawner, Point } from './types';

function scriptedFoodSpawner(...points: Point[]): FoodSpawner {
  const queue = points.map(({ x, y }) => ({ x, y }));
  return (occupied, width, height) => queue.shift() ?? spawnFood(occupied, width, height, () => 0);
}

function finiteFoodSpawner(...points: Point[]): FoodSpawner {
  const queue = points.map(({ x, y }) => ({ x, y }));
  return () => queue.shift() ?? null;
}

function sequenceRandom(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

describe('速度配置', () => {
  it('食物数量很大时仍不会低于最低间隔', () => {
    expect(tickMsForFoodCount(10_000)).toBe(65);
  });
});

describe('多食物配置', () => {
  it('提供 40×24 棋盘、六个常驻食物和限时双倍奖励参数', () => {
    expect(DEFAULT_WIDTH).toBe(40);
    expect(DEFAULT_HEIGHT).toBe(24);
    expect(NORMAL_FOOD_TARGET).toBe(6);
    expect(BONUS_FOOD_MIN).toBe(6);
    expect(BONUS_FOOD_MAX).toBe(10);
    expect(BONUS_FOOD_MIN_INTERVAL_MS).toBe(30_000);
    expect(BONUS_FOOD_MAX_INTERVAL_MS).toBe(120_000);
    expect(BONUS_FOOD_LIFETIME_MS).toBe(5_000);
    expect(SCORE_PER_FOOD).toBe(10);
    expect(BONUS_SCORE_PER_FOOD).toBe(20);
  });
});

describe('食物生成', () => {
  it('只会在未占用格子中按行优先顺序选择', () => {
    const occupied = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];

    expect(spawnFood(occupied, 2, 2, () => 0)).toEqual({ x: 1, y: 1 });
  });

  it('棋盘占满时返回空', () => {
    const occupied = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];

    expect(spawnFood(occupied, 2, 1, () => 0.5)).toBeNull();
  });

  it('将异常随机数夹到有效选择范围', () => {
    expect(spawnFood([], 2, 1, () => 1)).toEqual({ x: 1, y: 0 });
    expect(spawnFood([], 2, 1, () => -1)).toEqual({ x: 0, y: 0 });
    expect(spawnFood([], 2, 1, () => Number.NaN)).toEqual({ x: 0, y: 0 });
  });

  it('拒绝无效宽度', () => {
    expect(() => spawnFood([], Number.NaN, 1, () => 0)).toThrow(
      '棋盘宽度必须为非负安全整数',
    );
    expect(() => spawnFood([], 1.5, 1, () => 0)).toThrow('棋盘宽度必须为非负安全整数');
    expect(() => spawnFood([], -1, 1, () => 0)).toThrow('棋盘宽度必须为非负安全整数');
    expect(() => spawnFood([], Number.POSITIVE_INFINITY, 1, () => 0)).toThrow(
      '棋盘宽度必须为非负安全整数',
    );
  });

  it('拒绝无效高度', () => {
    expect(() => spawnFood([], 1, Number.NaN, () => 0)).toThrow(
      '棋盘高度必须为非负安全整数',
    );
    expect(() => spawnFood([], 1, 1.5, () => 0)).toThrow('棋盘高度必须为非负安全整数');
    expect(() => spawnFood([], 1, -1, () => 0)).toThrow('棋盘高度必须为非负安全整数');
    expect(() => spawnFood([], 1, Number.POSITIVE_INFINITY, () => 0)).toThrow(
      '棋盘高度必须为非负安全整数',
    );
  });

  it('拒绝总格数超过上限的棋盘', () => {
    expect(() => spawnFood([], 65_537, 1, () => 0)).toThrow(
      '棋盘总格数不能超过 65536 格',
    );
  });

  it('零尺寸棋盘立即返回空', () => {
    expect(spawnFood([], 0, Number.MAX_SAFE_INTEGER, () => 0)).toBeNull();
    expect(spawnFood([], Number.MAX_SAFE_INTEGER, 0, () => 0)).toBeNull();
  });
});

describe('游戏初始化与移动', () => {
  it('默认使用 40×24 棋盘并生成六个不重叠蛇身的普通食物', () => {
    const snapshot = new SnakeEngine({ random: () => 0 }).snapshot();
    const positions = snapshot.foods.map(({ x, y }) => `${x},${y}`);

    expect(snapshot).toMatchObject({ width: 40, height: 24 });
    expect(snapshot.foods).toHaveLength(6);
    expect(snapshot.foods.every(({ kind }) => kind === 'normal')).toBe(true);
    expect(new Set(positions).size).toBe(6);
    expect(snapshot.foods.every((food) => (
      snapshot.body.every(({ x, y }) => x !== food.x || y !== food.y)
    ))).toBe(true);
  });

  it('以四节身体就绪，开始后向右移动一格', () => {
    const engine = new SnakeEngine({ width: 14, height: 10, random: () => 0 });

    expect(engine.snapshot()).toMatchObject({
      width: 14,
      height: 10,
      body: [
        { x: 7, y: 5 },
        { x: 6, y: 5 },
        { x: 5, y: 5 },
        { x: 4, y: 5 },
      ],
      direction: 'right',
      status: 'ready',
      score: 0,
      foodCount: 0,
      tickMs: 150,
    });
    expect(engine.start()).toBe(true);
    expect(engine.start()).toBe(false);

    expect(engine.step()).toEqual([]);
    expect(engine.snapshot().body).toEqual([
      { x: 8, y: 5 },
      { x: 7, y: 5 },
      { x: 6, y: 5 },
      { x: 5, y: 5 },
    ]);
  });

  it('拒绝直接反向并按顺序消费两次快速转向', () => {
    const engine = new SnakeEngine({ width: 14, height: 10, random: () => 0 });
    engine.start();

    expect(engine.queueDirection('left')).toBe(false);
    expect(engine.queueDirection('up')).toBe(true);
    expect(engine.queueDirection('left')).toBe(true);
    expect(engine.queueDirection('down')).toBe(false);

    engine.step();
    expect(engine.snapshot().direction).toBe('up');
    expect(engine.snapshot().body[0]).toEqual({ x: 7, y: 4 });

    engine.step();
    expect(engine.snapshot().direction).toBe('left');
    expect(engine.snapshot().body[0]).toEqual({ x: 6, y: 4 });
  });
});

describe('进食与速度', () => {
  it('吃掉任意普通食物后增长计分并立即补足六个普通食物', () => {
    const refill = { x: 5, y: 0 };
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      foodSpawner: scriptedFoodSpawner(
        { x: 8, y: 5 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        refill,
      ),
    });
    engine.start();

    expect(engine.step()).toEqual([
      { type: 'foodEaten', at: { x: 8, y: 5 }, score: 10 },
    ]);
    const snapshot = engine.snapshot();
    expect(snapshot.body).toHaveLength(5);
    expect(snapshot.foods).toHaveLength(6);
    expect(snapshot.foods.every(({ kind }) => kind === 'normal')).toBe(true);
    expect(snapshot.foods).toContainEqual({ ...refill, kind: 'normal' });
  });

  it('连续吃五个食物后增长、计分并提升一级速度', () => {
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      foodSpawner: scriptedFoodSpawner(
        ...[8, 9, 10, 11, 12].map((x) => ({ x, y: 5 })),
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        { x: 5, y: 0 },
      ),
    });
    engine.start();

    for (let count = 1; count <= 4; count += 1) {
      expect(engine.step()).toEqual([
        { type: 'foodEaten', at: { x: 7 + count, y: 5 }, score: count * 10 },
      ]);
    }
    expect(engine.step()).toEqual([
      { type: 'foodEaten', at: { x: 12, y: 5 }, score: 50 },
      { type: 'speedChanged', level: 1, tickMs: 145 },
    ]);

    expect(engine.snapshot()).toMatchObject({
      score: 50,
      foodCount: 5,
      tickMs: 145,
    });
    expect(engine.snapshot().body).toHaveLength(9);
  });

  it('吃满五格棋盘后完成游戏并清空食物', () => {
    const engine = new SnakeEngine({ width: 5, height: 1, random: () => 0 });
    expect(engine.snapshot().foods).toEqual([{ x: 4, y: 0, kind: 'normal' }]);
    engine.start();

    expect(engine.step()).toEqual([
      { type: 'foodEaten', at: { x: 4, y: 0 }, score: 10 },
      { type: 'completed', score: 10 },
    ]);
    expect(engine.snapshot()).toMatchObject({
      status: 'completed',
      foods: [],
      score: 10,
    });
    expect(engine.snapshot().body).toHaveLength(5);
  });

  it('第十次进食恰好通关时只报告进食与通关事件', () => {
    const foods: Point[] = [
      { x: 4, y: 1 },
      { x: 5, y: 1 },
      { x: 6, y: 1 },
      { x: 6, y: 0 },
      { x: 5, y: 0 },
      { x: 4, y: 0 },
      { x: 3, y: 0 },
      { x: 2, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 0 },
    ];
    const engine = new SnakeEngine({
      width: 7,
      height: 2,
      foodSpawner: finiteFoodSpawner(...foods),
    });
    engine.start();

    engine.step();
    engine.step();
    engine.step();
    engine.queueDirection('up');
    engine.step();
    engine.queueDirection('left');
    for (let count = 0; count < 5; count += 1) {
      engine.step();
    }

    expect(engine.step()).toEqual([
      { type: 'foodEaten', at: { x: 0, y: 0 }, score: 100 },
      { type: 'completed', score: 100 },
    ]);
    expect(engine.snapshot()).toMatchObject({
      status: 'completed',
      foods: [],
      foodCount: 10,
    });
  });
});

describe('限时双倍奖励食物', () => {
  it('每隔最短三十秒生成六个，五秒后只清除奖励食物', () => {
    const normalPoints = Array.from({ length: 6 }, (_, x) => ({ x, y: 0 }));
    const firstBonusPoints = Array.from({ length: 6 }, (_, x) => ({ x, y: 1 }));
    const secondBonusPoints = Array.from({ length: 6 }, (_, x) => ({ x, y: 2 }));
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      random: sequenceRandom(0, 0, 0, 0, 0),
      foodSpawner: scriptedFoodSpawner(
        ...normalPoints,
        ...firstBonusPoints,
        ...secondBonusPoints,
      ),
    });
    engine.start();

    const playing = engine.snapshot();
    engine.advanceTime(29_999);
    expect(engine.snapshot()).toBe(playing);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);

    engine.advanceTime(1);
    const firstBatch = engine.snapshot();
    expect(firstBatch.foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(6);
    expect(firstBatch.foods.filter(({ kind }) => kind === 'normal')).toHaveLength(6);

    engine.advanceTime(4_999);
    expect(engine.snapshot()).toBe(firstBatch);
    engine.advanceTime(1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'normal')).toHaveLength(6);

    engine.advanceTime(24_999);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);
    engine.advanceTime(1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(6);
  });

  it('单次跨过奖励生成和到期边界时按出现时刻计时', () => {
    const normalPoints = Array.from({ length: 6 }, (_, x) => ({ x, y: 0 }));
    const firstBonusPoints = Array.from({ length: 6 }, (_, x) => ({ x, y: 1 }));
    const secondBonusPoints = Array.from({ length: 6 }, (_, x) => ({ x, y: 2 }));
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      random: sequenceRandom(0, 0, 0, 0, 0),
      foodSpawner: scriptedFoodSpawner(
        ...normalPoints,
        ...firstBonusPoints,
        ...secondBonusPoints,
      ),
    });
    engine.start();

    engine.advanceTime(34_999);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(6);
    engine.advanceTime(1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);

    engine.advanceTime(24_999);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);
    engine.advanceTime(1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(6);
  });

  it('单次三万五千毫秒后奖励已生成并到期', () => {
    const points = [
      ...Array.from({ length: 6 }, (_, x) => ({ x, y: 0 })),
      ...Array.from({ length: 6 }, (_, x) => ({ x, y: 1 })),
    ];
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      random: sequenceRandom(0, 0, 0),
      foodSpawner: scriptedFoodSpawner(...points),
    });
    engine.start();
    const before = engine.snapshot();

    engine.advanceTime(35_000);
    const after = engine.snapshot();
    expect(after.foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);
    expect(after).toBe(before);
  });

  it('随机数为一时在一百二十秒生成十个奖励食物', () => {
    const normalPoints = Array.from({ length: 6 }, (_, x) => ({ x, y: 0 }));
    const bonusPoints = Array.from({ length: 10 }, (_, x) => ({ x, y: 1 }));
    const engine = new SnakeEngine({
      width: 20,
      height: 10,
      random: sequenceRandom(1, 1, 1),
      foodSpawner: scriptedFoodSpawner(...normalPoints, ...bonusPoints),
    });
    engine.start();

    engine.advanceTime(119_999);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);
    engine.advanceTime(1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(10);
  });

  it.each([
    ['NaN', Number.NaN, 30_000, 6],
    ['负无穷', Number.NEGATIVE_INFINITY, 30_000, 6],
    ['负数', -1, 30_000, 6],
    ['正无穷', Number.POSITIVE_INFINITY, 120_000, 10],
    ['大于一', 2, 120_000, 10],
  ])('将%s随机数夹到抽样范围', (_caseName, randomValue, intervalMs, count) => {
    const normalPoints = Array.from({ length: 6 }, (_, x) => ({ x, y: 0 }));
    const bonusPoints = Array.from({ length: 10 }, (_, x) => ({ x, y: 1 }));
    const engine = new SnakeEngine({
      width: 20,
      height: 10,
      random: sequenceRandom(randomValue, randomValue, 0),
      foodSpawner: scriptedFoodSpawner(...normalPoints, ...bonusPoints),
    });
    engine.start();

    engine.advanceTime(intervalMs - 1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);
    engine.advanceTime(1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(count);
  });

  it('吃掉奖励食物获得二十分、增长一格且不会补充奖励', () => {
    const normalPoints = Array.from({ length: 6 }, (_, x) => ({ x, y: 0 }));
    const bonusPoints = [
      { x: 8, y: 5 },
      ...Array.from({ length: 5 }, (_, x) => ({ x, y: 1 })),
    ];
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      random: sequenceRandom(0, 0, 0),
      foodSpawner: scriptedFoodSpawner(...normalPoints, ...bonusPoints),
    });
    engine.start();
    engine.advanceTime(30_000);

    expect(engine.step()).toEqual([
      { type: 'foodEaten', at: { x: 8, y: 5 }, score: 20 },
    ]);
    const snapshot = engine.snapshot();
    expect(snapshot.body).toHaveLength(5);
    expect(snapshot).toMatchObject({ score: 20, foodCount: 1 });
    expect(snapshot.foods.filter(({ kind }) => kind === 'normal')).toHaveLength(6);
    expect(snapshot.foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(5);
  });

  it('就绪和暂停期间不计时，恢复后从原进度继续', () => {
    const points = [
      ...Array.from({ length: 6 }, (_, x) => ({ x, y: 0 })),
      ...Array.from({ length: 6 }, (_, x) => ({ x, y: 1 })),
    ];
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      random: sequenceRandom(0, 0, 0),
      foodSpawner: scriptedFoodSpawner(...points),
    });

    engine.advanceTime(30_000);
    engine.start();
    engine.advanceTime(29_999);
    engine.togglePause();
    engine.advanceTime(30_000);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);

    engine.togglePause();
    engine.advanceTime(1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(6);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1])(
    '异常时间增量 %s 按零处理',
    (deltaMs) => {
      const points = [
        ...Array.from({ length: 6 }, (_, x) => ({ x, y: 0 })),
        ...Array.from({ length: 6 }, (_, x) => ({ x, y: 1 })),
      ];
      const engine = new SnakeEngine({
        width: 14,
        height: 10,
        random: sequenceRandom(0, 0, 0),
        foodSpawner: scriptedFoodSpawner(...points),
      });
      engine.start();
      const before = engine.snapshot();

      engine.advanceTime(deltaMs);
      expect(engine.snapshot()).toBe(before);
      engine.advanceTime(29_999);
      expect(engine.snapshot()).toBe(before);
      engine.advanceTime(1);
      expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(6);
    },
  );

  it.each([Number.MAX_SAFE_INTEGER, Number.MAX_VALUE])(
    '极大的有限时间增量 %s 不会使计时停滞',
    (deltaMs) => {
      const points = [
        ...Array.from({ length: 6 }, (_, x) => ({ x, y: 0 })),
        ...Array.from({ length: 6 }, (_, x) => ({ x, y: 1 })),
      ];
      const engine = new SnakeEngine({
        width: 14,
        height: 10,
        random: sequenceRandom(0, 0, 0),
        foodSpawner: scriptedFoodSpawner(...points),
      });
      engine.start();

      expect(() => engine.advanceTime(deltaMs)).not.toThrow();
      expect(engine.snapshot().foods.filter(({ kind }) => kind === 'normal')).toHaveLength(6);
    },
  );

  it('暂停时重开会清除奖励并重新抽取首次倒计时', () => {
    const points = [
      ...Array.from({ length: 6 }, (_, x) => ({ x, y: 0 })),
      ...Array.from({ length: 6 }, (_, x) => ({ x, y: 1 })),
      ...Array.from({ length: 6 }, (_, x) => ({ x, y: 2 })),
      ...Array.from({ length: 6 }, (_, x) => ({ x, y: 3 })),
    ];
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      random: sequenceRandom(0, 0, 0, 1, 0, 0),
      foodSpawner: scriptedFoodSpawner(...points),
    });
    engine.start();
    engine.advanceTime(30_000);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(6);
    engine.togglePause();

    expect(engine.restart()).toBe(true);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);
    engine.start();
    engine.advanceTime(119_999);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);
    engine.advanceTime(1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(6);
  });

  it('空间不足时不会生成重叠奖励或移除普通食物', () => {
    const normalPoints = [
      ...Array.from({ length: 5 }, (_, x) => ({ x, y: 0 })),
      { x: 4, y: 1 },
    ];
    const engine = new SnakeEngine({
      width: 5,
      height: 2,
      random: sequenceRandom(0, 0, 0),
      foodSpawner: scriptedFoodSpawner(...normalPoints),
    });
    engine.start();

    expect(() => engine.advanceTime(30_000)).not.toThrow();
    const foods = engine.snapshot().foods;
    expect(foods).toHaveLength(6);
    expect(foods.every(({ kind }) => kind === 'normal')).toBe(true);
    expect(new Set(foods.map(({ x, y }) => `${x},${y}`)).size).toBe(6);
  });
});

describe('碰撞判定', () => {
  it('蛇头越过棋盘边界时结束游戏', () => {
    const engine = new SnakeEngine({ width: 5, height: 2, random: () => 0 });
    engine.start();
    engine.step();

    expect(engine.step()).toEqual([
      { type: 'gameOver', at: { x: 5, y: 1 } },
    ]);
    expect(engine.snapshot().status).toBe('gameOver');
  });

  it('蛇头撞到自身时结束游戏', () => {
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      foodSpawner: scriptedFoodSpawner(
        { x: 8, y: 5 },
        { x: 9, y: 5 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        { x: 5, y: 0 },
      ),
    });
    engine.start();
    engine.step();
    engine.step();
    engine.queueDirection('down');
    engine.step();
    engine.queueDirection('left');
    engine.step();
    engine.queueDirection('up');

    expect(engine.step()).toEqual([
      { type: 'gameOver', at: { x: 8, y: 5 } },
    ]);
    expect(engine.snapshot().status).toBe('gameOver');
  });

  it('未进食时允许蛇头进入本步即将离开的尾格', () => {
    const engine = new SnakeEngine({ width: 6, height: 4, random: () => 0 });
    engine.start();
    engine.queueDirection('up');
    engine.step();
    engine.queueDirection('left');
    engine.step();
    engine.queueDirection('down');

    expect(engine.step()).toEqual([]);
    expect(engine.snapshot().status).toBe('playing');
    expect(engine.snapshot().body[0]).toEqual({ x: 2, y: 2 });
  });
});

describe('状态控制', () => {
  it('可从暂停状态恢复游戏', () => {
    const engine = new SnakeEngine({ width: 14, height: 10, random: () => 0 });
    engine.start();
    engine.togglePause();

    expect(engine.snapshot().status).toBe('paused');
    expect(engine.togglePause()).toBe(true);
    expect(engine.snapshot().status).toBe('playing');
  });

  it('暂停时冻结步进并可从暂停状态重新开始', () => {
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      foodSpawner: finiteFoodSpawner(
        { x: 8, y: 5 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ),
    });
    engine.start();
    engine.step();
    expect(engine.restart()).toBe(false);
    expect(engine.togglePause()).toBe(true);

    const paused = engine.snapshot();
    expect(engine.step()).toEqual([]);
    expect(engine.snapshot()).toEqual(paused);

    expect(engine.restart()).toBe(true);
    expect(engine.snapshot()).toMatchObject({
      status: 'ready',
      score: 0,
      foodCount: 0,
      direction: 'right',
    });
    expect(engine.snapshot().body).toHaveLength(4);
    expect(engine.togglePause()).toBe(false);
  });

  it('游戏结束后重新开始会回到就绪状态', () => {
    const engine = new SnakeEngine({ width: 5, height: 2, random: () => 0 });
    engine.start();
    engine.step();
    engine.step();
    expect(engine.snapshot().status).toBe('gameOver');

    expect(engine.restart()).toBe(true);
    expect(engine.snapshot()).toMatchObject({
      status: 'ready',
      score: 0,
      foodCount: 0,
      direction: 'right',
    });
  });

  it('通关后重新开始会回到就绪状态', () => {
    const engine = new SnakeEngine({ width: 5, height: 1, random: () => 0 });
    engine.start();
    engine.step();
    expect(engine.snapshot().status).toBe('completed');

    expect(engine.restart()).toBe(true);
    expect(engine.snapshot()).toMatchObject({
      status: 'ready',
      score: 0,
      foodCount: 0,
      direction: 'right',
    });
  });
});

describe('快照与构造边界', () => {
  it('状态未变化时复用同一个运行时只读快照', () => {
    const engine = new SnakeEngine({ width: 14, height: 10, random: () => 0 });
    const first = engine.snapshot();
    const second = engine.snapshot();

    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.body)).toBe(true);
    expect(first.body.every(Object.isFrozen)).toBe(true);
    expect(Object.isFrozen(first.foods)).toBe(true);
    expect(first.foods.every(Object.isFrozen)).toBe(true);
  });

  it('仅在状态、方向或蛇身实际变化后生成新快照', () => {
    const engine = new SnakeEngine({ width: 14, height: 10, random: () => 0 });
    const ready = engine.snapshot();

    expect(engine.queueDirection('up')).toBe(false);
    expect(engine.snapshot()).toBe(ready);

    expect(engine.start()).toBe(true);
    const playing = engine.snapshot();
    expect(playing).not.toBe(ready);
    expect(playing.status).toBe('playing');

    expect(engine.queueDirection('up')).toBe(true);
    expect(engine.snapshot()).toBe(playing);
    engine.step();
    const moved = engine.snapshot();
    expect(moved).not.toBe(playing);
    expect(moved.direction).toBe('up');
    expect(moved.body[0]).toEqual({ x: 7, y: 4 });

    expect(engine.togglePause()).toBe(true);
    const paused = engine.snapshot();
    expect(paused).not.toBe(moved);
    expect(paused.status).toBe('paused');
    engine.step();
    expect(engine.snapshot()).toBe(paused);

    expect(engine.restart()).toBe(true);
    const restarted = engine.snapshot();
    expect(restarted).not.toBe(paused);
    expect(restarted.status).toBe('ready');
  });

  it('快照数组和坐标被改写时不会污染引擎内部状态', () => {
    const engine = new SnakeEngine({ width: 14, height: 10, random: () => 0 });
    const snapshot = engine.snapshot();
    const exposedBody = snapshot.body as Array<{ x: number; y: number }>;
    const exposedFoods = snapshot.foods as Array<{ x: number; y: number; kind: string }>;

    expect(() => {
      exposedBody[0]!.x = 99;
    }).toThrow(TypeError);
    expect(() => {
      exposedBody.push({ x: 98, y: 98 });
    }).toThrow(TypeError);
    expect(() => {
      exposedFoods[0]!.x = 97;
    }).toThrow(TypeError);
    expect(() => {
      exposedFoods.push({ x: 96, y: 96, kind: 'normal' });
    }).toThrow(TypeError);

    expect(engine.snapshot().body).toEqual([
      { x: 7, y: 5 },
      { x: 6, y: 5 },
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ]);
    expect(engine.snapshot().foods[0]).toEqual({ x: 0, y: 0, kind: 'normal' });
  });

  it('拒绝无法容纳初始蛇和食物的棋盘尺寸', () => {
    expect(() => new SnakeEngine({ width: 4 })).toThrow('棋盘宽度至少为 5 格');
    expect(() => new SnakeEngine({ height: 0 })).toThrow('棋盘高度至少为 1 格');
  });

  it('拒绝不是安全整数的棋盘宽高', () => {
    expect(() => new SnakeEngine({ width: Number.NaN })).toThrow('棋盘宽度必须为安全整数');
    expect(() => new SnakeEngine({ width: 5.5 })).toThrow('棋盘宽度必须为安全整数');
    expect(() => new SnakeEngine({ width: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      '棋盘宽度必须为安全整数',
    );
    expect(() => new SnakeEngine({ width: Number.POSITIVE_INFINITY })).toThrow(
      '棋盘宽度必须为安全整数',
    );
    expect(() => new SnakeEngine({ height: Number.NaN })).toThrow('棋盘高度必须为安全整数');
    expect(() => new SnakeEngine({ height: 1.5 })).toThrow('棋盘高度必须为安全整数');
    expect(() => new SnakeEngine({ height: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      '棋盘高度必须为安全整数',
    );
    expect(() => new SnakeEngine({ height: Number.POSITIVE_INFINITY })).toThrow(
      '棋盘高度必须为安全整数',
    );
  });

  it.each([
    ['安全整数最大值乘一格', Number.MAX_SAFE_INTEGER, 1],
    ['刚超过总格数上限', 32_769, 2],
  ])('拒绝%s的超大棋盘', (_caseName, width, height) => {
    expect(() => new SnakeEngine({
      width,
      height,
      foodSpawner: () => ({ x: 0, y: 0 }),
    })).toThrow('棋盘总格数不能超过 65536 格');
  });

  it('复制食物生成器返回的坐标，避免外部别名改写内部状态', () => {
    const externalFood = { x: 0, y: 0 };
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      foodSpawner: finiteFoodSpawner(externalFood),
    });

    externalFood.x = 1;
    externalFood.y = 1;

    expect(engine.snapshot().foods).toEqual([{ x: 0, y: 0, kind: 'normal' }]);
  });

  it('进食后复制食物生成器再次返回的坐标', () => {
    const first = { x: 8, y: 5 };
    const externalNext = { x: 0, y: 0 };
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      foodSpawner: finiteFoodSpawner(
        first,
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        { x: 5, y: 0 },
        externalNext,
      ),
    });
    engine.start();

    expect(engine.step()).toEqual([
      { type: 'foodEaten', at: { x: 8, y: 5 }, score: 10 },
    ]);
    externalNext.x = 1;
    externalNext.y = 1;

    expect(engine.snapshot().foods).toContainEqual({ x: 0, y: 0, kind: 'normal' });
  });

  it.each([
    ['越界', { x: 14, y: 0 }, '食物坐标必须在棋盘内'],
    ['蛇身占用', { x: 8, y: 5 }, '食物不能生成在蛇身上'],
    ['小数', { x: 0.5, y: 0 }, '食物坐标必须为安全整数'],
  ])('进食后拒绝生成%s坐标的食物', (_caseName, nextFood, expectedError) => {
    const first = { x: 8, y: 5 };
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      foodSpawner: finiteFoodSpawner(
        first,
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        nextFood,
      ),
    });
    engine.start();

    expect(() => engine.step()).toThrow(expectedError);
  });

  it('拒绝食物生成器返回与已有食物重叠的坐标', () => {
    expect(() => new SnakeEngine({
      width: 14,
      height: 10,
      foodSpawner: finiteFoodSpawner(
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ),
    })).toThrow('食物不能与已有食物重叠');
  });

  it.each([
    ['右边界外', { x: 14, y: 0 }],
    ['上边界外', { x: 0, y: -1 }],
  ])('拒绝生成在棋盘%s的食物', (_caseName, food) => {
    expect(() => new SnakeEngine({
      width: 14,
      height: 10,
      foodSpawner: () => food,
    })).toThrow('食物坐标必须在棋盘内');
  });

  it('拒绝生成在蛇身上的食物', () => {
    expect(() => new SnakeEngine({
      width: 14,
      height: 10,
      foodSpawner: () => ({ x: 7, y: 5 }),
    })).toThrow('食物不能生成在蛇身上');
  });

  it.each([
    ['横坐标', { x: 0.5, y: 0 }],
    ['纵坐标', { x: 0, y: 0.5 }],
  ])('拒绝%s不是安全整数的食物', (_caseName, food) => {
    expect(() => new SnakeEngine({
      width: 14,
      height: 10,
      foodSpawner: () => food,
    })).toThrow('食物坐标必须为安全整数');
  });
});
