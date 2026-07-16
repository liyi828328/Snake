import { MAX_BOARD_CELLS } from './config';
import type { Point, RandomSource } from './types';

export function spawnFood(
  occupied: readonly Point[],
  width: number,
  height: number,
  random: RandomSource,
): Point | null {
  if (!Number.isSafeInteger(width) || width < 0) {
    throw new Error('棋盘宽度必须为非负安全整数');
  }
  if (!Number.isSafeInteger(height) || height < 0) {
    throw new Error('棋盘高度必须为非负安全整数');
  }
  if (width === 0 || height === 0) {
    return null;
  }
  if (height > 0 && width > Math.floor(MAX_BOARD_CELLS / height)) {
    throw new Error(`棋盘总格数不能超过 ${MAX_BOARD_CELLS} 格`);
  }

  const occupiedKeys = new Set(occupied.map(({ x, y }) => `${x},${y}`));
  const available: Point[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!occupiedKeys.has(`${x},${y}`)) {
        available.push({ x, y });
      }
    }
  }

  if (available.length === 0) {
    return null;
  }

  const randomIndex = Math.floor(random() * available.length);
  const index = Number.isNaN(randomIndex) ? 0 : Math.min(
    available.length - 1,
    Math.max(0, randomIndex),
  );
  return available[index]!;
}
