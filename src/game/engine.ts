import {
  BONUS_FOOD_LIFETIME_MS,
  BONUS_FOOD_MAX,
  BONUS_FOOD_MAX_INTERVAL_MS,
  BONUS_FOOD_MIN,
  BONUS_FOOD_MIN_INTERVAL_MS,
  BONUS_SCORE_PER_FOOD,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  DIRECTION_VECTOR,
  INITIAL_LENGTH,
  MAX_BOARD_CELLS,
  MAX_DIRECTION_QUEUE,
  NORMAL_FOOD_TARGET,
  OPPOSITE,
  SCORE_PER_FOOD,
  SPEED_UP_EVERY_FOOD,
  tickMsForFoodCount,
} from './config';
import { spawnFood } from './food';
import type {
  Direction,
  Food,
  FoodKind,
  FoodSpawner,
  GameEvent,
  GameSnapshot,
  GameStatus,
  Point,
  RandomSource,
} from './types';

const MAX_BONUS_TIMER_TRANSITIONS_PER_ADVANCE = 1_000;

export interface SnakeEngineOptions {
  readonly width?: number;
  readonly height?: number;
  readonly random?: RandomSource;
  readonly foodSpawner?: FoodSpawner;
}

export class SnakeEngine {
  private readonly width: number;
  private readonly height: number;
  private readonly random: RandomSource;
  private readonly foodSpawner: FoodSpawner;
  private body: Point[] = [];
  private foods: Food[] = [];
  private direction: Direction = 'right';
  private status: GameStatus = 'ready';
  private score = 0;
  private foodCount = 0;
  private directionQueue: Direction[] = [];
  private bonusCountdownMs = 0;
  private bonusRemainingMs = 0;
  private cachedSnapshot: GameSnapshot | null = null;

  constructor(options: SnakeEngineOptions = {}) {
    this.width = options.width ?? DEFAULT_WIDTH;
    this.height = options.height ?? DEFAULT_HEIGHT;
    this.random = options.random ?? Math.random;
    this.foodSpawner = options.foodSpawner ?? spawnFood;

    if (!Number.isSafeInteger(this.width)) {
      throw new Error('棋盘宽度必须为安全整数');
    }
    if (!Number.isSafeInteger(this.height)) {
      throw new Error('棋盘高度必须为安全整数');
    }
    if (this.width < INITIAL_LENGTH + 1) {
      throw new Error(`棋盘宽度至少为 ${INITIAL_LENGTH + 1} 格`);
    }
    if (this.height < 1) {
      throw new Error('棋盘高度至少为 1 格');
    }
    if (this.width > Math.floor(MAX_BOARD_CELLS / this.height)) {
      throw new Error(`棋盘总格数不能超过 ${MAX_BOARD_CELLS} 格`);
    }

    this.reset();
  }

  private reset(): void {
    this.invalidateSnapshot();
    const headX = Math.max(INITIAL_LENGTH - 1, Math.floor(this.width / 2));
    const headY = Math.floor(this.height / 2);
    this.body = Array.from({ length: INITIAL_LENGTH }, (_, index) => ({
      x: headX - index,
      y: headY,
    }));
    this.direction = 'right';
    this.status = 'ready';
    this.score = 0;
    this.foodCount = 0;
    this.directionQueue = [];
    this.foods = [];
    this.bonusCountdownMs = this.sampleInteger(
      BONUS_FOOD_MIN_INTERVAL_MS,
      BONUS_FOOD_MAX_INTERVAL_MS,
    );
    this.bonusRemainingMs = 0;
    this.fillNormalFoods();
  }

  private sampleInteger(min: number, max: number): number {
    const sampled = this.random();
    const clamped = Number.isNaN(sampled) ? 0 : Math.min(1, Math.max(0, sampled));
    return Math.min(max, min + Math.floor(clamped * (max - min + 1)));
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

  private spawnBonusFoods(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const food = this.nextFood('bonus');
      if (food === null) {
        return;
      }
      this.foods.push(food);
    }
  }

  private foodsMatch(previous: readonly Food[]): boolean {
    return previous.length === this.foods.length && previous.every((food, index) => {
      const current = this.foods[index];
      return current !== undefined
        && food.x === current.x
        && food.y === current.y
        && food.kind === current.kind;
    });
  }

  private nextFood(kind: FoodKind): Food | null {
    return this.validateFood(
      this.foodSpawner([...this.body, ...this.foods], this.width, this.height, this.random),
      kind,
    );
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

  start(): boolean {
    if (this.status !== 'ready') {
      return false;
    }

    this.invalidateSnapshot();
    this.status = 'playing';
    return true;
  }

  togglePause(): boolean {
    if (this.status === 'playing') {
      this.invalidateSnapshot();
      this.status = 'paused';
      return true;
    }
    if (this.status === 'paused') {
      this.invalidateSnapshot();
      this.status = 'playing';
      return true;
    }
    return false;
  }

  restart(): boolean {
    if (this.status === 'playing') {
      return false;
    }

    this.reset();
    return true;
  }

  advanceTime(deltaMs: number): void {
    if (this.status !== 'playing' || !Number.isFinite(deltaMs) || deltaMs <= 0) {
      return;
    }

    const previousFoods = [...this.foods];
    let remainingMs = deltaMs;
    let transitionCount = 0;

    try {
      while (
        remainingMs > 0
        && transitionCount < MAX_BONUS_TIMER_TRANSITIONS_PER_ADVANCE
      ) {
        const hadActiveBonus = this.bonusRemainingMs > 0;
        const untilExpiryMs = hadActiveBonus
          ? this.bonusRemainingMs
          : Number.POSITIVE_INFINITY;
        const elapsedMs = Math.min(remainingMs, this.bonusCountdownMs, untilExpiryMs);

        this.bonusCountdownMs -= elapsedMs;
        if (hadActiveBonus) {
          this.bonusRemainingMs -= elapsedMs;
        }
        remainingMs -= elapsedMs;

        if (hadActiveBonus && this.bonusRemainingMs === 0) {
          this.foods = this.foods.filter(({ kind }) => kind === 'normal');
          transitionCount += 1;
        }

        if (this.bonusCountdownMs === 0) {
          const count = this.sampleInteger(BONUS_FOOD_MIN, BONUS_FOOD_MAX);
          this.spawnBonusFoods(count);
          this.bonusRemainingMs = BONUS_FOOD_LIFETIME_MS;
          this.bonusCountdownMs = this.sampleInteger(
            BONUS_FOOD_MIN_INTERVAL_MS,
            BONUS_FOOD_MAX_INTERVAL_MS,
          );
          transitionCount += 1;
        }
      }
    } finally {
      if (!this.foodsMatch(previousFoods)) {
        this.invalidateSnapshot();
      }
    }
  }

  queueDirection(next: Direction): boolean {
    if (this.status !== 'playing' || this.directionQueue.length >= MAX_DIRECTION_QUEUE) {
      return false;
    }

    const previous = this.directionQueue.at(-1) ?? this.direction;
    if (next === previous || next === OPPOSITE[previous]) {
      return false;
    }

    this.directionQueue.push(next);
    return true;
  }

  step(): readonly GameEvent[] {
    if (this.status !== 'playing') {
      return [];
    }

    this.invalidateSnapshot();
    this.direction = this.directionQueue.shift() ?? this.direction;
    const head = this.body[0]!;
    const vector = DIRECTION_VECTOR[this.direction];
    const nextHead = { x: head.x + vector.x, y: head.y + vector.y };
    const eatenIndex = this.foods.findIndex(({ x, y }) => (
      nextHead.x === x && nextHead.y === y
    ));
    const eatenFood = eatenIndex === -1 ? null : this.foods[eatenIndex]!;
    const ateFood = eatenFood !== null;
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

    this.foodCount += 1;
    this.score += eatenFood.kind === 'bonus' ? BONUS_SCORE_PER_FOOD : SCORE_PER_FOOD;
    this.foods.splice(eatenIndex, 1);
    const events: GameEvent[] = [
      { type: 'foodEaten', at: { ...nextHead }, score: this.score },
    ];
    if (this.body.length === this.width * this.height) {
      this.foods = [];
      this.bonusCountdownMs = 0;
      this.bonusRemainingMs = 0;
      this.status = 'completed';
      events.push({ type: 'completed', score: this.score });
      return events;
    }
    if (eatenFood.kind === 'normal') {
      this.fillNormalFoods();
    }

    if (this.foodCount % SPEED_UP_EVERY_FOOD === 0) {
      events.push({
        type: 'speedChanged',
        level: Math.floor(this.foodCount / SPEED_UP_EVERY_FOOD),
        tickMs: tickMsForFoodCount(this.foodCount),
      });
    }

    return events;
  }

  private invalidateSnapshot(): void {
    this.cachedSnapshot = null;
  }
}
