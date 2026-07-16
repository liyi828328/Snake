export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

export type GameStatus = 'ready' | 'playing' | 'paused' | 'gameOver' | 'completed';

export interface GameSnapshot {
  readonly width: number;
  readonly height: number;
  readonly body: readonly Point[];
  readonly food: Point | null;
  readonly direction: Direction;
  readonly status: GameStatus;
  readonly score: number;
  readonly foodCount: number;
  readonly tickMs: number;
}

export type GameEvent =
  | { readonly type: 'foodEaten'; readonly at: Point; readonly score: number }
  | { readonly type: 'speedChanged'; readonly level: number; readonly tickMs: number }
  | { readonly type: 'gameOver'; readonly at: Point }
  | { readonly type: 'completed'; readonly score: number };

export type RandomSource = () => number;

export type FoodSpawner = (
  occupied: readonly Point[],
  width: number,
  height: number,
  random: RandomSource,
) => Point | null;
