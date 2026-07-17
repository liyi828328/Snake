# Multi-Food Rewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 40×24 neon Snake board with six persistent normal foods plus 6–10 temporary, double-score golden reward foods that appear every 30–120 seconds of active play.

**Architecture:** Keep all food placement, scoring, lifetime, and completion rules in `SnakeEngine`; expose immutable typed foods through `GameSnapshot`. Let `GameController` advance engine game-time only while playing, while `GameRenderer` derives its board dimensions from snapshots and reuses a PixiJS visual pool for normal and reward foods.

**Tech Stack:** TypeScript 5.8, Vitest 3, PixiJS 8, Vite 7, Playwright 1.54, CSS.

---

## File structure and responsibilities

- `src/game/config.ts`: default 40×24 board and all normal/reward food constants.
- `src/game/types.ts`: `FoodKind`, `Food`, and the `GameSnapshot.foods` contract.
- `src/game/food.ts`: unchanged single-position selector; the engine passes snake and existing foods as occupied cells.
- `src/game/engine.ts`: owns the six normal foods, reward batch timer, reward expiry, scoring, growth, validation, reset, and completion cleanup.
- `src/game/engine.test.ts`: deterministic rules, timing boundaries, scoring, immutability, near-full board, and validation coverage.
- `src/controller/game-controller.ts`: passes clamped active frame time to the engine before fixed-step movement.
- `src/controller/game-controller.test.ts`: proves time advances only during active play and the latest food snapshot is rendered.
- `src/render/theme.ts`: normal pink and reward gold palette; no board-dimension constants.
- `src/render/game-renderer.ts`: snapshot-driven board layout and reusable multi-food visual pool.
- `src/render/game-renderer.test.ts`: pure 40×24/custom-dimension layout calculations.
- `src/render/game-renderer-lifecycle.test.ts`: multi-food pool, color, animated rings, reduced-motion, reuse, and cleanup.
- `src/render/quality.test.ts`: exact theme contract after removing duplicated board dimensions.
- `src/ui/hud.test.ts`: snapshot fixture migration and 5:3/1280px CSS contract.
- `src/styles.css`: 5:3 arena, 1280px desktop maximum, and height-constrained responsive sizing.
- `e2e/game.spec.ts`: real-browser 5:3 board and small-viewport containment.
- `README.md`: player-facing board and food rules.

## Task 1: Add configuration and food type foundations

**Files:**
- Modify: `src/game/engine.test.ts`
- Modify: `src/game/config.ts`
- Modify: `src/game/types.ts`

- [ ] **Step 1: Write the failing configuration test**

Extend the config import in `src/game/engine.test.ts`, then add this test before the existing speed test:

```ts
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

describe('多食物配置', () => {
  it('提供 40×24 棋盘、六个常驻食物和限时双倍奖励参数', () => {
    expect({
      width: DEFAULT_WIDTH,
      height: DEFAULT_HEIGHT,
      normalTarget: NORMAL_FOOD_TARGET,
      bonusMin: BONUS_FOOD_MIN,
      bonusMax: BONUS_FOOD_MAX,
      intervalMin: BONUS_FOOD_MIN_INTERVAL_MS,
      intervalMax: BONUS_FOOD_MAX_INTERVAL_MS,
      lifetime: BONUS_FOOD_LIFETIME_MS,
      normalScore: SCORE_PER_FOOD,
      bonusScore: BONUS_SCORE_PER_FOOD,
    }).toEqual({
      width: 40,
      height: 24,
      normalTarget: 6,
      bonusMin: 6,
      bonusMax: 10,
      intervalMin: 30_000,
      intervalMax: 120_000,
      lifetime: 5_000,
      normalScore: 10,
      bonusScore: 20,
    });
  });
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
npm test -- src/game/engine.test.ts -t "提供 40×24 棋盘"
```

Expected: FAIL because the reward constants are not exported and `DEFAULT_WIDTH` is still 32.

- [ ] **Step 3: Add the minimal configuration and types**

Make the relevant constants in `src/game/config.ts` read exactly:

```ts
export const DEFAULT_WIDTH = 40;
export const DEFAULT_HEIGHT = 24;
export const INITIAL_LENGTH = 4;
export const SCORE_PER_FOOD = 10;
export const BONUS_SCORE_PER_FOOD = SCORE_PER_FOOD * 2;
export const NORMAL_FOOD_TARGET = 6;
export const BONUS_FOOD_MIN = 6;
export const BONUS_FOOD_MAX = 10;
export const BONUS_FOOD_MIN_INTERVAL_MS = 30_000;
export const BONUS_FOOD_MAX_INTERVAL_MS = 120_000;
export const BONUS_FOOD_LIFETIME_MS = 5_000;
export const INITIAL_TICK_MS = 150;
```

Add the following immediately after `Point` in `src/game/types.ts`; do not change `GameSnapshot` yet:

```ts
export type FoodKind = 'normal' | 'bonus';

export interface Food extends Point {
  readonly kind: FoodKind;
}
```

- [ ] **Step 4: Verify GREEN and the existing unit suite**

Run:

```bash
npm test -- src/game/engine.test.ts -t "提供 40×24 棋盘"
npm test
```

Expected: the targeted test and all existing unit tests PASS.

- [ ] **Step 5: Commit the foundation**

```bash
git add src/game/config.ts src/game/types.ts src/game/engine.test.ts
git commit -m "feat: define multi-food reward configuration"
```

## Task 2: Replace the single food with six persistent normal foods

**Files:**
- Modify: `src/game/types.ts`
- Modify: `src/game/engine.ts`
- Modify: `src/game/engine.test.ts`
- Modify: `src/render/game-renderer.ts`
- Modify: `src/render/game-renderer.test.ts`
- Modify: `src/render/game-renderer-lifecycle.test.ts`
- Modify: `src/ui/hud.test.ts`
- Modify: `src/controller/game-controller.test.ts`

- [ ] **Step 1: Add deterministic spawner helpers and failing engine tests**

Add this helper near the top of `src/game/engine.test.ts`:

```ts
import type { FoodSpawner, Point } from './types';

function scriptedFoodSpawner(...points: Point[]): FoodSpawner {
  const queue = points.map(({ x, y }) => ({ x, y }));
  return (occupied, width, height) => (
    queue.shift() ?? spawnFood(occupied, width, height, () => 0)
  );
}

function finiteFoodSpawner(...points: Point[]): FoodSpawner {
  const queue = points.map(({ x, y }) => ({ x, y }));
  return () => queue.shift() ?? null;
}
```

Add these tests:

```ts
describe('多个普通食物', () => {
  it('默认使用 40×24 棋盘并生成六个互不重叠的普通食物', () => {
    const engine = new SnakeEngine({ random: () => 0 });
    const snapshot = engine.snapshot();

    expect(snapshot.width).toBe(40);
    expect(snapshot.height).toBe(24);
    expect(snapshot.foods).toHaveLength(6);
    expect(snapshot.foods.every(({ kind }) => kind === 'normal')).toBe(true);
    expect(new Set(snapshot.foods.map(({ x, y }) => `${x},${y}`)).size).toBe(6);
    expect(snapshot.foods.every((food) => (
      !snapshot.body.some(({ x, y }) => x === food.x && y === food.y)
    ))).toBe(true);
  });

  it('吃掉普通食物后增长、获得十分并立即补足六个', () => {
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
        { x: 5, y: 0 },
      ),
    });
    engine.start();

    expect(engine.step()).toEqual([
      { type: 'foodEaten', at: { x: 8, y: 5 }, score: 10 },
    ]);
    expect(engine.snapshot().body).toHaveLength(5);
    expect(engine.snapshot().foods).toHaveLength(6);
    expect(engine.snapshot().foods).toContainEqual({ x: 5, y: 0, kind: 'normal' });
  });
});
```

- [ ] **Step 2: Run both tests and verify RED**

Run:

```bash
npm test -- src/game/engine.test.ts -t "多个普通食物"
```

Expected: FAIL because `GameSnapshot.foods` does not exist and the engine exposes only one food.

- [ ] **Step 3: Migrate the snapshot contract**

In `src/game/types.ts`, replace `GameSnapshot.food` with:

```ts
readonly foods: readonly Food[];
```

- [ ] **Step 4: Implement six normal foods in the engine**

In `src/game/engine.ts`, import `NORMAL_FOOD_TARGET` and the `Food`/`FoodKind` types. Replace the single `food` field with:

```ts
private foods: Food[] = [];
```

Replace reset, spawn, validation, and snapshot construction with these methods:

```ts
private reset(): void {
  this.invalidateSnapshot();
  const headX = Math.max(INITIAL_LENGTH - 1, Math.floor(this.width / 2));
  const headY = Math.floor(this.height / 2);
  this.body = Array.from({ length: INITIAL_LENGTH }, (_, index) => ({
    x: headX - index,
    y: headY,
  }));
  this.foods = [];
  this.direction = 'right';
  this.status = 'ready';
  this.score = 0;
  this.foodCount = 0;
  this.directionQueue = [];
  this.fillNormalFoods();
}

private fillNormalFoods(): void {
  while (this.foods.filter(({ kind }) => kind === 'normal').length < NORMAL_FOOD_TARGET) {
    const food = this.nextFood('normal');
    if (food === null) {
      return;
    }
    this.foods.push(food);
  }
}

private nextFood(kind: FoodKind): Food | null {
  const point = this.foodSpawner(
    [...this.body, ...this.foods],
    this.width,
    this.height,
    this.random,
  );
  return this.validateFood(point, kind);
}

private validateFood(point: Point | null, kind: FoodKind): Food | null {
  if (point === null) {
    return null;
  }
  if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)) {
    throw new Error('食物坐标必须为安全整数');
  }
  if (point.x < 0 || point.x >= this.width || point.y < 0 || point.y >= this.height) {
    throw new Error('食物坐标必须在棋盘内');
  }
  if (this.body.some(({ x, y }) => x === point.x && y === point.y)) {
    throw new Error('食物不能生成在蛇身上');
  }
  if (this.foods.some(({ x, y }) => x === point.x && y === point.y)) {
    throw new Error('食物不能与已有食物重叠');
  }
  return { x: point.x, y: point.y, kind };
}

snapshot(): GameSnapshot {
  if (this.cachedSnapshot) {
    return this.cachedSnapshot;
  }
  const body = Object.freeze(
    this.body.map(({ x, y }) => Object.freeze({ x, y })),
  );
  const foods = Object.freeze(
    this.foods.map(({ x, y, kind }) => Object.freeze({ x, y, kind })),
  );
  this.cachedSnapshot = Object.freeze({
    width: this.width,
    height: this.height,
    body,
    foods,
    direction: this.direction,
    status: this.status,
    score: this.score,
    foodCount: this.foodCount,
    tickMs: tickMsForFoodCount(this.foodCount),
  });
  return this.cachedSnapshot;
}
```

Replace `step()` with the following complete multi-food version:

```ts
step(): readonly GameEvent[] {
  if (this.status !== 'playing') {
    return [];
  }

  this.invalidateSnapshot();
  this.direction = this.directionQueue.shift() ?? this.direction;
  const head = this.body[0]!;
  const vector = DIRECTION_VECTOR[this.direction];
  const nextHead = { x: head.x + vector.x, y: head.y + vector.y };
  const eatenFoodIndex = this.foods.findIndex(
    ({ x, y }) => x === nextHead.x && y === nextHead.y,
  );
  const ateFood = eatenFoodIndex >= 0;
  const collisionBody = ateFood ? this.body : this.body.slice(0, -1);
  const hitWall = nextHead.x < 0
    || nextHead.x >= this.width
    || nextHead.y < 0
    || nextHead.y >= this.height;
  const hitBody = collisionBody.some(({ x, y }) => x === nextHead.x && y === nextHead.y);

  if (hitWall || hitBody) {
    this.status = 'gameOver';
    this.directionQueue = [];
    return [{ type: 'gameOver', at: { ...nextHead } }];
  }

  this.body.unshift(nextHead);
  if (!ateFood) {
    this.body.pop();
    return [];
  }

  this.foods.splice(eatenFoodIndex, 1);
  this.foodCount += 1;
  this.score += SCORE_PER_FOOD;
  const events: GameEvent[] = [
    { type: 'foodEaten', at: { ...nextHead }, score: this.score },
  ];
  if (this.body.length === this.width * this.height) {
    this.foods = [];
    this.status = 'completed';
    events.push({ type: 'completed', score: this.score });
    return events;
  }
  this.fillNormalFoods();

  if (this.foodCount % SPEED_UP_EVERY_FOOD === 0) {
    events.push({
      type: 'speedChanged',
      level: Math.floor(this.foodCount / SPEED_UP_EVERY_FOOD),
      tickMs: tickMsForFoodCount(this.foodCount),
    });
  }
  return events;
}
```

- [ ] **Step 5: Migrate existing engine assertions and scripted queues**

In `src/game/engine.test.ts`:

- Replace completion assertions using `food: null` with `foods: []`.
- Replace `.food` reads with `.foods[0]` only where the test intentionally inspects one coordinate.
- Change immutability assertions to check `Object.isFrozen(snapshot.foods)`, every food object, a rejected coordinate write, and a rejected `push`.
- Use `scriptedFoodSpawner(...)` when the board should keep filling deterministic free cells after the scripted coordinates.
- Use `finiteFoodSpawner(...)` when the test requires generation to stop after its listed coordinates.
- For “进食后拒绝生成” cases, queue the edible point, five legal filler points, then the invalid point so the invalid result is consumed by the refill after eating rather than during initialization.

Use this exact immutability block:

```ts
const exposedFoods = snapshot.foods as Array<{ x: number; y: number; kind: 'normal' }>;
expect(() => {
  exposedFoods[0]!.x = 97;
}).toThrow(TypeError);
expect(() => {
  exposedFoods.push({ x: 96, y: 96, kind: 'normal' });
}).toThrow(TypeError);
expect(engine.snapshot().foods[0]).toEqual({ x: 0, y: 0, kind: 'normal' });
```

- [ ] **Step 6: Migrate non-engine snapshot fixtures and keep rendering temporarily single-item**

Use these exact fixture values:

```ts
// src/render/game-renderer.test.ts
foods: [{ x: 10, y: 8, kind: 'normal' }],

// src/render/game-renderer-lifecycle.test.ts
foods: [{ x: 10, y: 8, kind: 'normal' }],

// src/ui/hud.test.ts
width: 40,
height: 24,
foods: [{ x: 8, y: 8, kind: 'normal' }],
```

In `src/render/game-renderer.ts`, make the existing single visual read the first item until Task 6 installs the pool:

```ts
private drawFood(snapshot: GameSnapshot): void {
  const food = snapshot.foods[0];
  if (!this.layout || !food) {
    this.foodContainer.visible = false;
    return;
  }
  this.cellToPixel(food, this.foodPixel);
  const pulseTime = this.reducedMotion ? 0 : this.elapsedMs;
  const firstPulse = (Math.sin(pulseTime * 0.006) + 1) / 2;
  const secondPulse = (Math.sin(pulseTime * 0.006 + Math.PI) + 1) / 2;
  this.foodContainer.position.set(this.foodPixel.x, this.foodPixel.y);
  this.foodFirstPulseGraphic.scale.set(0.3 + firstPulse * 0.12);
  this.foodFirstPulseGraphic.alpha = 0.44 * (1 - firstPulse);
  this.foodSecondPulseGraphic.scale.set(0.36 + secondPulse * 0.12);
  this.foodSecondPulseGraphic.alpha = 0.32 * (1 - secondPulse);
  this.foodContainer.visible = true;
}
```

In controller tests that inject an edible coordinate, provide six initial legal coordinates and one refill coordinate. For the existing `width: 8, height: 4` score test, use:

```ts
const foods = [
  { x: 5, y: 2 },
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 2, y: 0 },
  { x: 3, y: 0 },
  { x: 4, y: 0 },
  { x: 5, y: 0 },
];
```

Make the default controller harness deterministic so its six normal foods cannot randomly alter movement assertions:

```ts
const engine = options.engine ?? new SnakeEngine({
  width: 14,
  height: 10,
  random: () => 0,
});
```

- [ ] **Step 7: Verify the migration is green**

Run:

```bash
npm test -- src/game/engine.test.ts
npm test
npm run build
```

Expected: all engine tests, the complete unit suite, and TypeScript/Vite build PASS with no remaining `GameSnapshot.food` references.

- [ ] **Step 8: Commit persistent normal foods**

```bash
git add src/game/types.ts src/game/engine.ts src/game/engine.test.ts src/render/game-renderer.ts src/render/game-renderer.test.ts src/render/game-renderer-lifecycle.test.ts src/ui/hud.test.ts src/controller/game-controller.test.ts
git commit -m "feat: maintain six normal foods"
```

## Task 3: Add timed reward batches and double scoring

**Files:**
- Modify: `src/game/engine.test.ts`
- Modify: `src/game/engine.ts`

- [ ] **Step 1: Add deterministic random and reward tests**

Add this helper to `src/game/engine.test.ts`:

```ts
function sequenceRandom(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}
```

Add tests with a scripted spawner whose first six coordinates are `{ x: 0..5, y: 0 }` and whose following coordinates are reward positions:

```ts
describe('限时奖励食物', () => {
  it('三十秒边界生成六个奖励食物并在五秒后移除', () => {
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

    engine.advanceTime(29_999);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);
    engine.advanceTime(1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(6);
    engine.advanceTime(4_999);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(6);
    engine.advanceTime(1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'normal')).toHaveLength(6);
    engine.advanceTime(24_999);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);
    engine.advanceTime(1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(6);
  });

  it('一百二十秒边界最多生成十个奖励食物', () => {
    const points = [
      ...Array.from({ length: 6 }, (_, x) => ({ x, y: 0 })),
      ...Array.from({ length: 10 }, (_, x) => ({ x, y: 1 })),
    ];
    const engine = new SnakeEngine({
      width: 20,
      height: 10,
      random: sequenceRandom(1, 1, 1),
      foodSpawner: scriptedFoodSpawner(...points),
    });
    engine.start();

    engine.advanceTime(119_999);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(0);
    engine.advanceTime(1);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(10);
  });

  it('奖励食物提供二十分但只增长一格并计作一个食物', () => {
    const points = [
      ...Array.from({ length: 6 }, (_, x) => ({ x, y: 0 })),
      { x: 8, y: 5 },
      { x: 9, y: 0 },
      { x: 10, y: 0 },
      { x: 11, y: 0 },
      { x: 12, y: 0 },
      { x: 13, y: 0 },
    ];
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      random: sequenceRandom(0, 0, 0),
      foodSpawner: scriptedFoodSpawner(...points),
    });
    engine.start();
    engine.advanceTime(30_000);

    expect(engine.step()).toEqual([
      { type: 'foodEaten', at: { x: 8, y: 5 }, score: 20 },
    ]);
    expect(engine.snapshot()).toMatchObject({ score: 20, foodCount: 1 });
    expect(engine.snapshot().body).toHaveLength(5);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'normal')).toHaveLength(6);
    expect(engine.snapshot().foods.filter(({ kind }) => kind === 'bonus')).toHaveLength(5);
  });

  it('就绪、暂停和无效时间不推进奖励倒计时，重新开始会清空奖励', () => {
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
    engine.advanceTime(Number.POSITIVE_INFINITY);
    engine.advanceTime(Number.NaN);
    engine.advanceTime(-1);
    engine.advanceTime(29_999);
    engine.togglePause();
    engine.advanceTime(30_000);
    expect(engine.snapshot().foods.some(({ kind }) => kind === 'bonus')).toBe(false);
    engine.togglePause();
    engine.advanceTime(1);
    expect(engine.snapshot().foods.some(({ kind }) => kind === 'bonus')).toBe(true);
    engine.togglePause();
    engine.restart();
    expect(engine.snapshot().foods.some(({ kind }) => kind === 'bonus')).toBe(false);
  });
});
```

- [ ] **Step 2: Run reward tests and verify RED**

Run:

```bash
npm test -- src/game/engine.test.ts -t "限时奖励食物"
```

Expected: FAIL because `SnakeEngine.advanceTime` does not exist.

- [ ] **Step 3: Implement timer sampling, spawning, expiry, and cleanup**

Import all reward constants in `src/game/engine.ts`, then add:

```ts
private bonusCountdownMs = 0;
private bonusRemainingMs = 0;

private sampleInteger(minimum: number, maximum: number): number {
  const value = this.random();
  const normalized = Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : 0;
  return Math.min(
    maximum,
    minimum + Math.floor(normalized * (maximum - minimum + 1)),
  );
}

private spawnBonusFoods(count: number): void {
  for (let index = 0; index < count; index += 1) {
    const food = this.nextFood('bonus');
    if (food === null) {
      return;
    }
    this.foods.push(food);
  }
}

advanceTime(deltaMs: number): void {
  if (this.status !== 'playing') {
    return;
  }
  const elapsedMs = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
  if (elapsedMs === 0) {
    return;
  }

  let foodsChanged = false;
  if (this.bonusRemainingMs > 0) {
    this.bonusRemainingMs = Math.max(0, this.bonusRemainingMs - elapsedMs);
    if (this.bonusRemainingMs === 0) {
      const previousLength = this.foods.length;
      this.foods = this.foods.filter(({ kind }) => kind === 'normal');
      foodsChanged = this.foods.length !== previousLength;
    }
  }

  this.bonusCountdownMs -= elapsedMs;
  if (this.bonusCountdownMs <= 0) {
    this.foods = this.foods.filter(({ kind }) => kind === 'normal');
    const previousLength = this.foods.length;
    this.spawnBonusFoods(this.sampleInteger(BONUS_FOOD_MIN, BONUS_FOOD_MAX));
    this.bonusRemainingMs = BONUS_FOOD_LIFETIME_MS;
    this.bonusCountdownMs = this.sampleInteger(
      BONUS_FOOD_MIN_INTERVAL_MS,
      BONUS_FOOD_MAX_INTERVAL_MS,
    );
    foodsChanged = foodsChanged || this.foods.length !== previousLength;
  }

  if (foodsChanged) {
    this.invalidateSnapshot();
  }
}
```

In `reset()`, before `fillNormalFoods()`, add:

```ts
this.bonusCountdownMs = this.sampleInteger(
  BONUS_FOOD_MIN_INTERVAL_MS,
  BONUS_FOOD_MAX_INTERVAL_MS,
);
this.bonusRemainingMs = 0;
```

In `step()`, capture the eaten food before splicing and score by kind:

```ts
const eatenFood = eatenFoodIndex >= 0 ? this.foods[eatenFoodIndex] : undefined;
// ... collision and body movement ...
this.foods.splice(eatenFoodIndex, 1);
this.foodCount += 1;
this.score += eatenFood?.kind === 'bonus'
  ? BONUS_SCORE_PER_FOOD
  : SCORE_PER_FOOD;
```

Only call `fillNormalFoods()` when `eatenFood?.kind === 'normal'`. When completing the board, also set both bonus timers to zero.

- [ ] **Step 4: Add near-full and duplicate-coordinate coverage**

Add these assertions to `src/game/engine.test.ts`:

```ts
it('可用格不足时只生成能放下的食物且不会重叠', () => {
  const engine = new SnakeEngine({ width: 5, height: 2, random: () => 0 });
  const snapshot = engine.snapshot();
  expect(snapshot.foods).toHaveLength(6);
  expect(new Set(snapshot.foods.map(({ x, y }) => `${x},${y}`)).size).toBe(6);
  engine.start();
  expect(() => engine.advanceTime(120_000)).not.toThrow();
  expect(engine.snapshot().foods).toHaveLength(6);
});

it('拒绝食物生成器返回与已有食物重复的坐标', () => {
  const point = { x: 0, y: 0 };
  expect(() => new SnakeEngine({
    width: 14,
    height: 10,
    foodSpawner: () => point,
  })).toThrow('食物不能与已有食物重叠');
});
```

- [ ] **Step 5: Verify reward behavior and regression suite**

Run:

```bash
npm test -- src/game/engine.test.ts
npm test
npm run build
```

Expected: all commands PASS. The reward tests must prove both timing endpoints, five-second expiry, 20-point scoring, one-cell growth, pause freeze, restart cleanup, capacity limiting, and duplicate rejection.

- [ ] **Step 6: Commit engine reward behavior**

```bash
git add src/game/engine.ts src/game/engine.test.ts
git commit -m "feat: add timed double-score reward foods"
```

## Task 4: Advance reward time from the game controller

**Files:**
- Modify: `src/controller/game-controller.test.ts`
- Modify: `src/controller/game-controller.ts`

- [ ] **Step 1: Write failing active-time controller tests**

Add these tests to `src/controller/game-controller.test.ts`:

```ts
it('仅在 playing 动画帧按 250ms 上限推进引擎游戏时间', () => {
  const engine = new SnakeEngine({ width: 14, height: 10, random: () => 1 });
  const advanceTime = vi.spyOn(engine, 'advanceTime');
  const { controller, frames } = setup({ engine, now: () => 0 });
  controller.start();

  window.dispatchEvent(new Event('resize'));
  frames.run(500);
  expect(advanceTime).not.toHaveBeenCalled();

  press(' ');
  frames.run(500);
  expect(advanceTime).toHaveBeenLastCalledWith(250);

  press(' ');
  window.dispatchEvent(new Event('resize'));
  frames.run(750);
  expect(advanceTime).toHaveBeenCalledTimes(1);
});

it('奖励食物集合变化时当前帧渲染最新快照', () => {
  const engine = new SnakeEngine({ width: 14, height: 10, random: () => 0 });
  engine.start();
  engine.advanceTime(29_750);
  const { controller, renderer, frames } = setup({ engine, now: () => 0 });
  controller.start();
  frames.run(250);

  expect(renderer.renders.at(-1)?.current.foods.some(
    ({ kind }) => kind === 'bonus',
  )).toBe(true);
});
```

- [ ] **Step 2: Run controller tests and verify RED**

Run:

```bash
npm test -- src/controller/game-controller.test.ts -t "推进引擎游戏时间|当前帧渲染最新快照"
```

Expected: the first test FAILS because `advanceTime` is never called; the second FAILS because no rewards appear through controller frames.

- [ ] **Step 3: Advance time before fixed-step movement**

Replace the beginning of the `playing` branch in `handleFrame` with:

```ts
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
```

Do not call `advanceTime` from pause, visibility, restart, or terminal animation paths; those paths already stop active frames or bypass the `playing` branch.

- [ ] **Step 4: Verify controller timing and pause/visibility regression**

Run:

```bash
npm test -- src/controller/game-controller.test.ts
npm test
```

Expected: all controller and unit tests PASS, including existing blur and page-hidden pause cases.

- [ ] **Step 5: Commit controller integration**

```bash
git add src/controller/game-controller.ts src/controller/game-controller.test.ts
git commit -m "feat: advance rewards during active play"
```

## Task 5: Make the board 40×24, 5:3, and snapshot-driven

**Files:**
- Modify: `src/render/game-renderer.test.ts`
- Modify: `src/render/game-renderer.ts`
- Modify: `src/render/theme.ts`
- Modify: `src/render/quality.test.ts`
- Modify: `src/ui/hud.test.ts`
- Modify: `src/styles.css`
- Modify: `e2e/game.spec.ts`

- [ ] **Step 1: Write failing pure layout tests**

Replace the layout expectations in `src/render/game-renderer.test.ts` with:

```ts
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

  it('按快照尺寸支持自定义 14×10 棋盘', () => {
    expect(calculateBoardLayout(800, 600, 14, 10)).toEqual({
      cell: 30,
      boardWidth: 420,
      boardHeight: 300,
      x: 190,
      y: 150,
    });
  });

  it('320×192 小屏仍完整容纳 40×24 棋盘和边距', () => {
    expect(calculateBoardLayout(320, 192, 40, 24)).toEqual({
      cell: 6,
      boardWidth: 240,
      boardHeight: 144,
      x: 40,
      y: 24,
    });
  });
});
```

- [ ] **Step 2: Run layout tests and verify RED**

Run:

```bash
npm test -- src/render/game-renderer.test.ts -t "棋盘布局"
```

Expected: FAIL because `calculateBoardLayout` ignores the requested columns and rows and caps the board at 32×24.

- [ ] **Step 3: Implement dimension-aware layout and grid drawing**

Import `DEFAULT_WIDTH` and `DEFAULT_HEIGHT` in `src/render/game-renderer.ts`, then replace `calculateBoardLayout` with:

```ts
export function calculateBoardLayout(
  screenWidth: number,
  screenHeight: number,
  columns = DEFAULT_WIDTH,
  rows = DEFAULT_HEIGHT,
): BoardLayout {
  const safeWidth = Number.isFinite(screenWidth) ? Math.max(0, screenWidth) : 0;
  const safeHeight = Number.isFinite(screenHeight) ? Math.max(0, screenHeight) : 0;
  const safeColumns = Number.isSafeInteger(columns) && columns > 0
    ? columns
    : DEFAULT_WIDTH;
  const safeRows = Number.isSafeInteger(rows) && rows > 0
    ? rows
    : DEFAULT_HEIGHT;
  const maximumWidth = Math.max(0, safeWidth - 48);
  const maximumHeight = Math.max(0, safeHeight - 48);
  const cell = Math.max(0, Math.min(
    30,
    maximumWidth / safeColumns,
    maximumHeight / safeRows,
  ));
  const boardWidth = cell * safeColumns;
  const boardHeight = cell * safeRows;
  return {
    cell,
    boardWidth,
    boardHeight,
    x: Math.max(0, Math.floor((safeWidth - boardWidth) / 2)),
    y: Math.max(0, Math.floor((safeHeight - boardHeight) / 2)),
  };
}
```

Add renderer fields:

```ts
private boardColumns = DEFAULT_WIDTH;
private boardRows = DEFAULT_HEIGHT;
```

Replace `ensureLayout` with:

```ts
private ensureLayout(
  columns = this.boardColumns,
  rows = this.boardRows,
): void {
  if (!this.app) {
    return;
  }

  const width = this.app.screen.width;
  const height = this.app.screen.height;
  if (
    width === this.screenWidth
    && height === this.screenHeight
    && columns === this.boardColumns
    && rows === this.boardRows
    && this.layout
  ) {
    return;
  }

  const previousCell = this.layout?.cell;
  this.screenWidth = width;
  this.screenHeight = height;
  this.boardColumns = columns;
  this.boardRows = rows;
  this.layout = calculateBoardLayout(width, height, columns, rows);
  this.redrawBackground();
  this.redrawBoardAndGrid();
  this.redrawFoodGeometry();
  this.redrawImpactGeometry();
  if (this.glowFilter) {
    this.glowFilter.strength = Math.max(4, this.layout.cell * 0.24);
  }
  if (previousCell !== this.layout.cell) {
    this.redrawSegmentGeometry();
  }
}
```

Call `ensureLayout(current.width, current.height)` from `render`, and `ensureLayout(DEFAULT_WIDTH, DEFAULT_HEIGHT)` during initial setup. Replace both grid loops and completion-rain horizontal placement to use `this.boardColumns` and `this.boardRows` rather than theme constants.

- [ ] **Step 4: Remove duplicated theme dimensions and add reward gold**

Make `src/render/theme.ts` read:

```ts
export const THEME = {
  background: 0x020611,
  board: 0x030817,
  grid: 0x1ceaff,
  cyan: 0x45f4ff,
  magenta: 0xe45bff,
  food: 0xff3b8d,
  bonusFood: 0xffd166,
  white: 0xf1ffff,
  gridAlpha: 0.075,
} as const;
```

Update the exact object assertion in `src/render/quality.test.ts` to match this object and rename the test to “提供霓虹主题色与奖励金色”.

- [ ] **Step 5: Write failing CSS contract tests**

In `src/ui/hud.test.ts`, replace the old width assertions with:

```ts
expect(styles).toContain(
  'width: min(1280px, 100%, max(240px, calc(166.667vh - 433.333px)));',
);
expect(styles).toContain(
  'width: min(1280px, 100%, max(240px, calc(166.667dvh - 433.333px)));',
);
expect(styles).toMatch(/\.arena\s*\{[^}]*aspect-ratio:\s*5 \/ 3;/s);
```

Run:

```bash
npm test -- src/ui/hud.test.ts -t "游戏框宽度"
```

Expected: FAIL because CSS still contains 1100px, the 4:3 height formula, and `aspect-ratio: 4 / 3`.

- [ ] **Step 6: Implement the 5:3 responsive shell**

In `src/styles.css`, set:

```css
.game-shell {
  width: min(1280px, 100%, max(240px, calc(166.667vh - 433.333px)));
  width: min(1280px, 100%, max(240px, calc(166.667dvh - 433.333px)));
}

.arena {
  aspect-ratio: 5 / 3;
}
```

Change only the `width` declarations in `.game-shell` and the `aspect-ratio` declaration in `.arena`; retain their existing position, overflow, border, background, and shadow declarations.

- [ ] **Step 7: Update real-browser ratio expectations and verify them**

In `e2e/game.spec.ts`:

- Rename “常见视口保持画布、提示阈值和 4:3 布局” to use “5:3 布局”.
- Rename “320×400 视口完整显示 4:3 棋盘” to use “5:3 棋盘”.
- Replace each `toBeCloseTo(4 / 3, ...)` ratio with `toBeCloseTo(5 / 3, ...)`.
- At the 1366×768 check, replace `await expect(page.locator('.hud__identity')).toBeHidden()` with `await expect(page.locator('.hud__identity')).toBeVisible()` because the expanded shell is wider than the 720px container breakpoint.
- Retain the existing containment, no-scroll, HUD bounds, hidden-page redraw, and viewport-hint assertions.

Run:

```bash
npm test -- src/render/game-renderer.test.ts src/render/quality.test.ts src/ui/hud.test.ts
npm run test:e2e -- --grep "5:3|320×400|隐藏期间缩至"
```

Expected: the selected unit and Playwright tests PASS.

- [ ] **Step 8: Commit board and layout changes**

```bash
git add src/render/game-renderer.ts src/render/game-renderer.test.ts src/render/theme.ts src/render/quality.test.ts src/ui/hud.test.ts src/styles.css e2e/game.spec.ts
git commit -m "feat: expand board to 40 by 24"
```

## Task 6: Render all foods with pooled golden reward rings

**Files:**
- Modify: `src/render/game-renderer-lifecycle.test.ts`
- Modify: `src/render/game-renderer.ts`

- [ ] **Step 1: Make the lifecycle snapshot helper accept multiple foods**

Replace its helper with:

```ts
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
```

- [ ] **Step 2: Write failing pool, color, ring, and reduced-motion tests**

Import `Graphics` and `THEME`, then add:

```ts
it('为普通和奖励食物创建复用视觉并使用粉色与金色', async () => {
  const host = createFakeHost();
  const fake = createFakeApplication(Promise.resolve());
  const renderer = new GameRenderer(host.element, rendererOptions(() => fake.application));
  await renderer.init();

  const state = snapshot({
    foods: [
      { x: 10, y: 8, kind: 'normal' },
      { x: 12, y: 8, kind: 'bonus' },
    ],
  });
  renderer.render(state, state, 1, 0);

  const scene = fake.application.stage.children[0] as Container;
  const foodLayer = scene.children[5] as Container;
  expect(foodLayer.children).toHaveLength(2);
  const normal = foodLayer.children[0] as Container;
  const bonus = foodLayer.children[1] as Container;
  expect(normal.visible).toBe(true);
  expect(bonus.visible).toBe(true);
  expect((normal.children[2] as Graphics).tint).toBe(THEME.food);
  expect((bonus.children[2] as Graphics).tint).toBe(THEME.bonusFood);
  renderer.destroy();
});

it('奖励光圈向外扩散且食物减少时隐藏并复用池对象', async () => {
  const host = createFakeHost();
  const fake = createFakeApplication(Promise.resolve());
  const renderer = new GameRenderer(host.element, rendererOptions(() => fake.application));
  await renderer.init();
  const twoFoods = snapshot({
    foods: [
      { x: 10, y: 8, kind: 'normal' },
      { x: 12, y: 8, kind: 'bonus' },
    ],
  });
  renderer.render(twoFoods, twoFoods, 1, 0);
  const scene = fake.application.stage.children[0] as Container;
  const foodLayer = scene.children[5] as Container;
  const bonus = foodLayer.children[1] as Container;
  const firstRing = bonus.children[0] as Graphics;
  const initialScale = firstRing.scale.x;

  renderer.render(twoFoods, twoFoods, 1, 350);
  expect(firstRing.scale.x).toBeGreaterThan(initialScale);
  renderer.render(snapshot(), snapshot(), 1, 16);
  expect(foodLayer.children).toHaveLength(2);
  expect(foodLayer.children[0]?.visible).toBe(true);
  expect(foodLayer.children[1]?.visible).toBe(false);
  renderer.destroy();
});

it('减少动态效果时奖励食物使用静态金色柔光', async () => {
  const host = createFakeHost();
  const fake = createFakeApplication(Promise.resolve());
  const renderer = new GameRenderer(
    host.element,
    rendererOptions(() => fake.application, { reducedMotion: true }),
  );
  await renderer.init();
  const state = snapshot({ foods: [{ x: 12, y: 8, kind: 'bonus' }] });
  renderer.render(state, state, 1, 0);
  const scene = fake.application.stage.children[0] as Container;
  const foodLayer = scene.children[5] as Container;
  const firstRing = (foodLayer.children[0] as Container).children[0] as Graphics;
  const before = { scale: firstRing.scale.x, alpha: firstRing.alpha };

  renderer.render(state, state, 1, 350);
  expect({ scale: firstRing.scale.x, alpha: firstRing.alpha }).toEqual(before);
  expect(firstRing.alpha).toBeGreaterThan(0);
  renderer.destroy();
});
```

- [ ] **Step 3: Run lifecycle tests and verify RED**

Run:

```bash
npm test -- src/render/game-renderer-lifecycle.test.ts -t "普通和奖励食物|奖励光圈|静态金色柔光"
```

Expected: FAIL because the renderer still owns one food container and does not apply reward gold or outward ring phases.

- [ ] **Step 4: Replace single graphics with a food visual pool**

Add this interface:

```ts
interface FoodVisual {
  readonly container: Container;
  readonly core: Graphics;
  readonly outer: Graphics;
  readonly firstRing: Graphics;
  readonly secondRing: Graphics;
  readonly pixel: MutablePoint;
}
```

Replace all single-food fields with:

```ts
private readonly foodVisuals: FoodVisual[] = [];
```

Do not create a food container in `createLayers`. Add these methods:

```ts
private ensureFoodVisualCount(count: number): void {
  while (this.foodVisuals.length < count) {
    const container = new Container();
    const firstRing = new Graphics();
    const secondRing = new Graphics();
    const outer = new Graphics();
    const core = new Graphics();
    container.addChild(firstRing, secondRing, outer, core);
    this.foodLayer.addChild(container);
    const visual: FoodVisual = {
      container,
      core,
      outer,
      firstRing,
      secondRing,
      pixel: { x: 0, y: 0 },
    };
    this.foodVisuals.push(visual);
    this.redrawFoodGeometry(visual);
  }
}

private redrawFoodGeometry(visual: FoodVisual): void {
  if (!this.layout) {
    return;
  }
  const core = this.layout.cell * 0.11;
  const outer = this.layout.cell * 0.23;
  visual.core.clear().circle(0, 0, core).fill(THEME.white);
  visual.outer
    .clear()
    .circle(0, 0, outer)
    .stroke({ color: THEME.white, alpha: 0.92, width: Math.max(1.5, this.layout.cell * 0.07) });
  visual.firstRing
    .clear()
    .circle(0, 0, this.layout.cell)
    .stroke({ color: THEME.white, alpha: 1, width: 1.5 });
  visual.secondRing
    .clear()
    .circle(0, 0, this.layout.cell)
    .stroke({ color: THEME.white, alpha: 1, width: 1 });
  visual.container.visible = false;
}
```

In `ensureLayout`, replace the old no-argument food geometry redraw with:

```ts
for (const visual of this.foodVisuals) {
  this.redrawFoodGeometry(visual);
}
```

- [ ] **Step 5: Draw every food and animate reward rings**

Replace `drawFood` and its call site with this complete `drawFoods` implementation:

```ts
private drawFoods(snapshot: GameSnapshot): void {
  if (!this.layout) {
    return;
  }
  this.ensureFoodVisualCount(snapshot.foods.length);
  const pulseTime = this.reducedMotion ? 0 : this.elapsedMs;
  const normalFirst = (Math.sin(pulseTime * 0.006) + 1) / 2;
  const normalSecond = (Math.sin(pulseTime * 0.006 + Math.PI) + 1) / 2;
  const rewardFirst = (this.elapsedMs % 1_400) / 1_400;
  const rewardSecond = (rewardFirst + 0.5) % 1;

  for (let index = 0; index < this.foodVisuals.length; index += 1) {
    const visual = this.foodVisuals[index]!;
    const food = snapshot.foods[index];
    if (!food) {
      visual.container.visible = false;
      continue;
    }

    this.cellToPixel(food, visual.pixel);
    visual.container.position.set(visual.pixel.x, visual.pixel.y);
    const color = food.kind === 'bonus' ? THEME.bonusFood : THEME.food;
    visual.outer.tint = color;
    visual.firstRing.tint = color;
    visual.secondRing.tint = color;

    if (food.kind === 'bonus' && this.reducedMotion) {
      visual.firstRing.scale.set(0.58);
      visual.firstRing.alpha = 0.24;
      visual.secondRing.scale.set(0.78);
      visual.secondRing.alpha = 0.14;
    } else if (food.kind === 'bonus') {
      visual.firstRing.scale.set(0.3 + rewardFirst * 0.8);
      visual.firstRing.alpha = 0.55 * (1 - rewardFirst);
      visual.secondRing.scale.set(0.3 + rewardSecond * 0.8);
      visual.secondRing.alpha = 0.42 * (1 - rewardSecond);
    } else {
      visual.firstRing.scale.set(0.3 + normalFirst * 0.12);
      visual.firstRing.alpha = 0.44 * (1 - normalFirst);
      visual.secondRing.scale.set(0.36 + normalSecond * 0.12);
      visual.secondRing.alpha = 0.32 * (1 - normalSecond);
    }
    visual.container.visible = true;
  }
}
```

Call `this.drawFoods(current)` from `render`. In cleanup, set `this.foodVisuals.length = 0` after the Pixi application destroys its children.

- [ ] **Step 6: Verify pool behavior and all rendering regressions**

Run:

```bash
npm test -- src/render/game-renderer-lifecycle.test.ts
npm test -- src/render/game-renderer.test.ts src/render/quality.test.ts
npm test
npm run build
```

Expected: all commands PASS; pool children remain allocated when food count shrinks, reward rings animate only when motion is enabled, and reward outer/rings use `THEME.bonusFood`.

- [ ] **Step 7: Commit multi-food rendering**

```bash
git add src/render/game-renderer.ts src/render/game-renderer-lifecycle.test.ts
git commit -m "feat: render pooled golden reward foods"
```

## Task 7: Document the rules and run full acceptance

**Files:**
- Modify: `README.md`
- Verify: `docs/superpowers/specs/2026-07-17-multi-food-rewards-design.md`
- Verify: all source and test files changed in Tasks 1–6

- [ ] **Step 1: Update player-facing rules**

Add this section after “操作” in `README.md`:

```markdown
## 棋盘与食物

- 默认棋盘为 40×24 的长方形网格。
- 开局生成六个粉红色普通食物；每吃掉一个会立即补充一个，每个提供 10 分。
- 每隔随机 30–120 秒的实际游玩时间，会出现 6–10 个金色奖励食物。
- 奖励食物带有向外扩散的金色光圈，保留五秒，每个提供 20 分；吃掉后不会补充。
- 暂停、窗口失焦或页面隐藏时，奖励出现与消失倒计时都会冻结。
```

- [ ] **Step 2: Scan for stale single-food and old-board contracts**

Run:

```bash
rg -n "GameSnapshot\.food\b|snapshot\.food\b|this\.food\b|THEME\.boardColumns|THEME\.boardRows|32×24|4:3|8[–-]15" src e2e README.md
```

Expected: no stale single-food field, duplicated theme dimension, old default board, old ratio, or old reward interval remains. References to `foodCount`, `THEME.food`, `foodSpawner`, and historical design documents are valid and must not be removed.

- [ ] **Step 3: Run the complete unit and production build gate**

Run:

```bash
npm run check
```

Expected: every Vitest test PASS, TypeScript build PASS, and Vite production output completes without warnings or errors.

- [ ] **Step 4: Run the complete Chromium acceptance suite**

Run:

```bash
npm run test:e2e
```

Expected: every Playwright Chromium test PASS, including 5:3 layout, 320×400 containment, page-hidden redraw, keyboard flow, persistence, and WebGL fallback.

- [ ] **Step 5: Review the final diff for scope and unrelated changes**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Expected: only the files listed in this plan are changed by implementation. Preserve the pre-existing user modification in `package-lock.json`; do not stage or rewrite it unless the implementation itself changes dependencies, which this plan does not require.

- [ ] **Step 6: Commit documentation and acceptance updates**

```bash
git add README.md
git commit -m "docs: explain multi-food reward rules"
```
