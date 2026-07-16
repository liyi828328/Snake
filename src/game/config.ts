import type { Direction, Point } from './types';

export const DEFAULT_WIDTH = 32;
export const DEFAULT_HEIGHT = 24;
export const INITIAL_LENGTH = 4;
export const SCORE_PER_FOOD = 10;
export const INITIAL_TICK_MS = 150;
export const SPEED_UP_EVERY_FOOD = 5;
export const TICK_MS_DECREMENT = 5;
export const MIN_TICK_MS = 65;
export const MAX_DIRECTION_QUEUE = 2;
export const MAX_BOARD_CELLS = 65_536;

export const DIRECTION_VECTOR: Readonly<Record<Direction, Point>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const OPPOSITE: Readonly<Record<Direction, Direction>> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export function tickMsForFoodCount(foodCount: number): number {
  const level = Math.floor(foodCount / SPEED_UP_EVERY_FOOD);
  return Math.max(MIN_TICK_MS, INITIAL_TICK_MS - level * TICK_MS_DECREMENT);
}
