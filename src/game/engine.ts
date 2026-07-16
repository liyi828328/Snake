import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  DIRECTION_VECTOR,
  INITIAL_LENGTH,
  MAX_BOARD_CELLS,
  MAX_DIRECTION_QUEUE,
  OPPOSITE,
  SCORE_PER_FOOD,
  SPEED_UP_EVERY_FOOD,
  tickMsForFoodCount,
} from './config';
import { spawnFood } from './food';
import type {
  Direction,
  FoodSpawner,
  GameEvent,
  GameSnapshot,
  GameStatus,
  Point,
  RandomSource,
} from './types';

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
  private food: Point | null = null;
  private direction: Direction = 'right';
  private status: GameStatus = 'ready';
  private score = 0;
  private foodCount = 0;
  private directionQueue: Direction[] = [];
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
    this.food = this.nextFood();
  }

  private nextFood(): Point | null {
    return this.validateFood(
      this.foodSpawner(this.body, this.width, this.height, this.random),
    );
  }

  private validateFood(food: Point | null): Point | null {
    if (food === null) {
      return null;
    }
    if (!Number.isSafeInteger(food.x) || !Number.isSafeInteger(food.y)) {
      throw new Error('食物坐标必须为安全整数');
    }
    if (food.x < 0 || food.x >= this.width || food.y < 0 || food.y >= this.height) {
      throw new Error('食物坐标必须在棋盘内');
    }
    if (this.body.some(({ x, y }) => x === food.x && y === food.y)) {
      throw new Error('食物不能生成在蛇身上');
    }

    return { x: food.x, y: food.y };
  }

  snapshot(): GameSnapshot {
    if (this.cachedSnapshot) {
      return this.cachedSnapshot;
    }

    const body = Object.freeze(
      this.body.map(({ x, y }) => Object.freeze({ x, y })),
    );
    const food = this.food === null
      ? null
      : Object.freeze({ x: this.food.x, y: this.food.y });
    this.cachedSnapshot = Object.freeze({
      width: this.width,
      height: this.height,
      body,
      food,
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
    const ateFood = this.food !== null
      && nextHead.x === this.food.x
      && nextHead.y === this.food.y;
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
    this.score += SCORE_PER_FOOD;
    const events: GameEvent[] = [
      { type: 'foodEaten', at: { ...nextHead }, score: this.score },
    ];
    if (this.body.length === this.width * this.height) {
      this.food = null;
      this.status = 'completed';
      events.push({ type: 'completed', score: this.score });
      return events;
    }
    this.food = this.nextFood();

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
