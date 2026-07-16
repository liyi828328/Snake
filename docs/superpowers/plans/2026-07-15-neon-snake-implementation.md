# 霓虹贪吃蛇实施计划

> **供智能代理执行者：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项执行本计划。所有步骤使用复选框（`- [ ]`）跟踪。

**目标：** 构建一款桌面端优先、方向键控制、具有「霓虹深空」WebGL 特效，并能在高刷新率设备上以 120 FPS 为目标运行的经典贪吃蛇网页游戏。

**架构：** 纯 TypeScript 游戏引擎独立维护 32×24 网格、状态和规则；固定节拍循环将规则更新与 `requestAnimationFrame` 渲染分离。PixiJS 负责 WebGL 场景和特效，HTML/CSS 负责抬头显示与覆盖层，浏览器适配器负责音频和本地存储。

**技术栈：** Vite、TypeScript、PixiJS 8、Vitest、Playwright、HTML/CSS、Web Audio、`localStorage`

---

## 文件结构

```text
index.html                         页面入口
package.json                       依赖与脚本
tsconfig.json                      TypeScript 严格配置
vite.config.ts                     Vite 与 Vitest 配置
playwright.config.ts               浏览器验收配置
src/main.ts                        应用装配与启动
src/styles.css                     霓虹深空界面、响应式与减少动态效果样式
src/game/types.ts                  共享领域类型与游戏事件
src/game/config.ts                 棋盘、速度、计分等规则常量
src/game/food.ts                   确定性食物生成
src/game/engine.ts                 纯游戏引擎与状态机
src/game/engine.test.ts            引擎规则测试
src/game/input.ts                  仅方向键的输入映射与监听
src/game/input.test.ts             输入映射测试
src/game/clock.ts                  固定逻辑节拍与渲染插值时钟
src/game/clock.test.ts             时钟测试
src/adapters/storage.ts            最高分和静音偏好持久化
src/adapters/storage.test.ts       存储降级测试
src/adapters/audio.ts              Web Audio 合成音效
src/render/quality.ts              自适应效果质量控制
src/render/quality.test.ts         质量升降级测试
src/render/theme.ts                颜色与视觉参数
src/render/particles.ts            可复用粒子对象池
src/render/game-renderer.ts        PixiJS 场景、插值绘制和特效
src/ui/hud.ts                      抬头显示与状态覆盖层
src/controller/game-controller.ts  输入、引擎、渲染、音频和存储编排
e2e/game.spec.ts                   浏览器端完整流程测试
README.md                          中文运行、操作与测试说明
```

## 规格覆盖索引

- 32×24 棋盘、增长、计分、加速、碰撞、通关和状态机：任务二。
- 仅方向键、两步输入队列、暂停和重开：任务二、任务三、任务七。
- 最高分、静音偏好、合成音效及异常降级：任务四、任务七。
- 120 FPS 目标、60 FPS 下限、自适应质量和减少动态效果：任务五、任务六、任务八。
- 霓虹深空棋盘、蛇身、食物、粒子、脉冲、震动和故障效果：任务六、任务七。
- WebGL 失败、页面失焦、后台暂停和小视口提示：任务七。
- 单元测试、浏览器验收、生产构建及人工视觉检查：任务二至任务九。
- 中文文档和中文代码注释规范：任务一、任务七、任务八、任务九。

## 任务一：建立项目骨架与测试工具链

**文件：**
- 新建：`package.json`
- 新建：`tsconfig.json`
- 新建：`vite.config.ts`
- 新建：`playwright.config.ts`
- 新建：`index.html`
- 新建：`src/main.ts`
- 新建：`src/styles.css`

- [ ] **步骤 1：创建依赖与脚本清单**

```json
{
  "name": "neon-snake",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "check": "npm run test && npm run build"
  },
  "dependencies": {
    "pixi.js": "^8.8.1"
  },
  "devDependencies": {
    "@playwright/test": "^1.54.1",
    "jsdom": "^26.1.0",
    "typescript": "^5.8.3",
    "vite": "^7.0.0",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **步骤 2：安装依赖并生成锁文件**

运行：`npm install`

预期：生成 `package-lock.json`，命令以退出码 0 结束。

- [ ] **步骤 3：创建严格 TypeScript、Vite 和 Playwright 配置**

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "noEmit": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

`vite.config.ts`：

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
```

`playwright.config.ts`：

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **步骤 4：创建能够构建的最小页面**

`index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#020611" />
    <title>霓虹贪吃蛇</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts`：

```ts
import './styles.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('找不到应用根节点');
root.textContent = '霓虹贪吃蛇正在启动…';
```

`src/styles.css`：

```css
:root { color-scheme: dark; font-family: Inter, "PingFang SC", sans-serif; }
* { box-sizing: border-box; }
html, body, #app { width: 100%; min-height: 100%; margin: 0; }
body { background: #020611; color: #eaffff; }
```

- [ ] **步骤 5：验证最小项目**

运行：`npm run test && npm run build`

预期：Vitest 报告没有测试文件但正常退出，Vite 成功生成 `dist/`。若当前 Vitest 对无测试返回非零，则临时运行 `npm run build`，任务二加入首个测试后再执行完整检查。

- [ ] **步骤 6：提交项目骨架**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts playwright.config.ts index.html src/main.ts src/styles.css
git commit -m "chore: 建立霓虹贪吃蛇项目骨架"
```

## 任务二：以测试驱动实现纯游戏引擎

**文件：**
- 新建：`src/game/types.ts`
- 新建：`src/game/config.ts`
- 新建：`src/game/food.ts`
- 新建：`src/game/engine.ts`
- 新建：`src/game/engine.test.ts`

- [ ] **步骤 1：编写失败的引擎规则测试**

`src/game/engine.test.ts` 至少包含以下具体用例：

```ts
import { describe, expect, it } from 'vitest';
import { SnakeEngine } from './engine';
import type { FoodSpawner, Point } from './types';

const foods = (...points: Point[]): FoodSpawner => {
  const queue = [...points];
  return () => queue.shift() ?? null;
};

describe('SnakeEngine', () => {
  it('从中央以四格长度进入游戏并向右移动', () => {
    const engine = new SnakeEngine({ width: 10, height: 8, foodSpawner: foods({ x: 9, y: 7 }) });
    expect(engine.snapshot().body).toHaveLength(4);
    engine.start();
    const before = engine.snapshot().body[0];
    engine.step();
    expect(engine.snapshot().body[0]).toEqual({ x: before!.x + 1, y: before!.y });
  });

  it('拒绝直接反向，并保存最多两个快速转向', () => {
    const engine = new SnakeEngine({ width: 12, height: 10, foodSpawner: foods({ x: 0, y: 0 }) });
    engine.start();
    expect(engine.queueDirection('left')).toBe(false);
    expect(engine.queueDirection('up')).toBe(true);
    expect(engine.queueDirection('left')).toBe(true);
    expect(engine.queueDirection('down')).toBe(false);
    engine.step();
    expect(engine.snapshot().direction).toBe('up');
    engine.step();
    expect(engine.snapshot().direction).toBe('left');
  });

  it('进食后增长、加十分并按公式加速', () => {
    const engine = new SnakeEngine({
      width: 14,
      height: 10,
      foodSpawner: foods(
        { x: 8, y: 5 }, { x: 9, y: 5 }, { x: 10, y: 5 },
        { x: 11, y: 5 }, { x: 12, y: 5 }, { x: 0, y: 0 },
      ),
    });
    engine.start();
    for (let index = 0; index < 5; index += 1) engine.step();
    expect(engine.snapshot()).toMatchObject({ score: 50, foodCount: 5, tickMs: 145 });
    expect(engine.snapshot().body).toHaveLength(9);
  });

  it('撞墙后进入游戏结束状态', () => {
    const engine = new SnakeEngine({ width: 6, height: 4, foodSpawner: foods({ x: 0, y: 0 }) });
    engine.start();
    while (engine.snapshot().status === 'playing') engine.step();
    expect(engine.snapshot().status).toBe('gameOver');
  });

  it('撞到自身后进入游戏结束状态', () => {
    const engine = new SnakeEngine({
      width: 8,
      height: 8,
      foodSpawner: foods({ x: 5, y: 4 }, { x: 6, y: 4 }, { x: 0, y: 0 }),
    });
    engine.start();
    engine.step();
    engine.step();
    engine.queueDirection('down'); engine.step();
    engine.queueDirection('left'); engine.step();
    engine.queueDirection('up'); engine.step();
    expect(engine.snapshot().status).toBe('gameOver');
  });

  it('占满棋盘后进入通关状态', () => {
    const engine = new SnakeEngine({ width: 5, height: 1, foodSpawner: foods({ x: 4, y: 0 }) });
    engine.start();
    engine.step();
    expect(engine.snapshot()).toMatchObject({ status: 'completed', food: null, score: 10 });
  });

  it('暂停后冻结，重开后恢复全新待开始状态', () => {
    const engine = new SnakeEngine({ width: 10, height: 8, foodSpawner: foods({ x: 0, y: 0 }, { x: 0, y: 1 }) });
    engine.start();
    engine.togglePause();
    const paused = engine.snapshot();
    engine.step();
    expect(engine.snapshot()).toEqual(paused);
    expect(engine.restart()).toBe(true);
    expect(engine.snapshot()).toMatchObject({ status: 'ready', score: 0, foodCount: 0 });
  });

  it('速度间隔不会低于 65 毫秒', async () => {
    const { tickMsForFoodCount } = await import('./config');
    expect(tickMsForFoodCount(10000)).toBe(65);
  });
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`npm run test -- src/game/engine.test.ts`

预期：失败，提示找不到 `./engine` 或 `SnakeEngine`。

- [ ] **步骤 3：定义领域类型与规则常量**

`src/game/types.ts`：

```ts
export type Direction = 'up' | 'down' | 'left' | 'right';
export type GameStatus = 'ready' | 'playing' | 'paused' | 'gameOver' | 'completed';

export interface Point { readonly x: number; readonly y: number }

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
  occupied: readonly Point[], width: number, height: number, random: RandomSource,
) => Point | null;
```

`src/game/config.ts`：

```ts
import type { Direction, Point } from './types';

export const GAME_CONFIG = {
  width: 32,
  height: 24,
  initialLength: 4,
  pointsPerFood: 10,
  foodsPerLevel: 5,
  initialTickMs: 150,
  tickStepMs: 5,
  minimumTickMs: 65,
  inputQueueSize: 2,
} as const;

export const DIRECTION_VECTOR: Record<Direction, Point> = {
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};

export const OPPOSITE: Record<Direction, Direction> = {
  up: 'down', down: 'up', left: 'right', right: 'left',
};

export const tickMsForFoodCount = (foodCount: number): number =>
  Math.max(
    GAME_CONFIG.minimumTickMs,
    GAME_CONFIG.initialTickMs - Math.floor(foodCount / GAME_CONFIG.foodsPerLevel) * GAME_CONFIG.tickStepMs,
  );
```

- [ ] **步骤 4：实现食物生成**

`src/game/food.ts`：

```ts
import type { FoodSpawner } from './types';

export const spawnFood: FoodSpawner = (occupied, width, height, random) => {
  const used = new Set(occupied.map(({ x, y }) => `${x}:${y}`));
  const free = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!used.has(`${x}:${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) return null;
  const index = Math.min(free.length - 1, Math.floor(Math.max(0, random()) * free.length));
  return free[index] ?? null;
};
```

在 `engine.test.ts` 中另加食物生成断言：

```ts
it('食物只生成在空闲格子，棋盘占满时返回空值', async () => {
  const { spawnFood } = await import('./food');
  expect(spawnFood([{ x: 0, y: 0 }], 2, 1, () => 0)).toEqual({ x: 1, y: 0 });
  expect(spawnFood([{ x: 0, y: 0 }, { x: 1, y: 0 }], 2, 1, () => 0)).toBeNull();
});
```

- [ ] **步骤 5：实现完整纯引擎**

`src/game/engine.ts` 必须提供以下公开接口，并按给出的顺序处理每个逻辑节拍：

```ts
import { DIRECTION_VECTOR, GAME_CONFIG, OPPOSITE, tickMsForFoodCount } from './config';
import { spawnFood } from './food';
import type { Direction, FoodSpawner, GameEvent, GameSnapshot, Point, RandomSource } from './types';

interface EngineOptions {
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
  private directionQueue: Direction[] = [];
  private status: GameSnapshot['status'] = 'ready';
  private score = 0;
  private foodCount = 0;

  constructor(options: EngineOptions = {}) {
    this.width = options.width ?? GAME_CONFIG.width;
    this.height = options.height ?? GAME_CONFIG.height;
    this.random = options.random ?? Math.random;
    this.foodSpawner = options.foodSpawner ?? spawnFood;
    if (this.width < GAME_CONFIG.initialLength + 1 || this.height < 1) {
      throw new Error('棋盘尺寸不足以容纳初始蛇身和食物');
    }
    this.resetState();
  }

  snapshot(): GameSnapshot {
    return {
      width: this.width, height: this.height,
      body: this.body.map((point) => ({ ...point })),
      food: this.food ? { ...this.food } : null,
      direction: this.direction, status: this.status,
      score: this.score, foodCount: this.foodCount,
      tickMs: tickMsForFoodCount(this.foodCount),
    };
  }

  start(): boolean {
    if (this.status !== 'ready') return false;
    this.status = 'playing';
    return true;
  }

  togglePause(): boolean {
    if (this.status === 'playing') { this.status = 'paused'; return true; }
    if (this.status === 'paused') { this.status = 'playing'; return true; }
    return false;
  }

  restart(): boolean {
    if (this.status === 'playing') return false;
    this.resetState();
    return true;
  }

  queueDirection(next: Direction): boolean {
    if (this.status !== 'playing' || this.directionQueue.length >= GAME_CONFIG.inputQueueSize) return false;
    const previous = this.directionQueue.at(-1) ?? this.direction;
    if (next === previous || next === OPPOSITE[previous]) return false;
    this.directionQueue.push(next);
    return true;
  }

  step(): readonly GameEvent[] {
    if (this.status !== 'playing') return [];
    this.direction = this.directionQueue.shift() ?? this.direction;
    const head = this.body[0]!;
    const vector = DIRECTION_VECTOR[this.direction];
    const next = { x: head.x + vector.x, y: head.y + vector.y };
    const outside = next.x < 0 || next.x >= this.width || next.y < 0 || next.y >= this.height;
    if (outside) return this.endAt(next);

    const willEat = this.food?.x === next.x && this.food.y === next.y;
    const collisionBody = willEat ? this.body : this.body.slice(0, -1);
    if (collisionBody.some((part) => part.x === next.x && part.y === next.y)) return this.endAt(next);

    const events: GameEvent[] = [];
    this.body.unshift(next);
    if (!willEat) { this.body.pop(); return events; }

    const previousLevel = Math.floor(this.foodCount / GAME_CONFIG.foodsPerLevel);
    this.foodCount += 1;
    this.score += GAME_CONFIG.pointsPerFood;
    events.push({ type: 'foodEaten', at: next, score: this.score });
    if (this.body.length === this.width * this.height) {
      this.food = null;
      this.status = 'completed';
      events.push({ type: 'completed', score: this.score });
      return events;
    }

    this.food = this.foodSpawner(this.body, this.width, this.height, this.random);
    const level = Math.floor(this.foodCount / GAME_CONFIG.foodsPerLevel);
    if (level > previousLevel) {
      events.push({ type: 'speedChanged', level, tickMs: tickMsForFoodCount(this.foodCount) });
    }
    return events;
  }

  private endAt(at: Point): readonly GameEvent[] {
    this.status = 'gameOver';
    this.directionQueue = [];
    return [{ type: 'gameOver', at }];
  }

  private resetState(): void {
    const headX = Math.max(GAME_CONFIG.initialLength - 1, Math.floor(this.width / 2));
    const headY = Math.floor(this.height / 2);
    this.body = Array.from({ length: GAME_CONFIG.initialLength }, (_, index) => ({ x: headX - index, y: headY }));
    this.direction = 'right';
    this.directionQueue = [];
    this.status = 'ready';
    this.score = 0;
    this.foodCount = 0;
    this.food = this.foodSpawner(this.body, this.width, this.height, this.random);
  }
}
```

- [ ] **步骤 6：运行引擎测试并修正测试数据**

运行：`npm run test -- src/game/engine.test.ts`

预期：全部引擎用例通过。若进食测试中的坐标与实际中心位置不一致，只调整测试注入的食物坐标，使其连续位于蛇头右侧；不得放宽断言或修改规则。

- [ ] **步骤 7：提交纯游戏引擎**

```bash
git add src/game
git commit -m "feat: 实现确定性贪吃蛇引擎"
```

## 任务三：实现仅方向键输入与固定节拍时钟

**文件：**
- 新建：`src/game/input.ts`
- 新建：`src/game/input.test.ts`
- 新建：`src/game/clock.ts`
- 新建：`src/game/clock.test.ts`

- [ ] **步骤 1：编写输入和时钟失败测试**

```ts
// src/game/input.test.ts
import { describe, expect, it, vi } from 'vitest';
import { KeyboardInput, commandFromKey } from './input';

describe('键盘输入', () => {
  it.each([['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right']])(
    '把 %s 映射为 %s', (key, direction) => expect(commandFromKey(key)).toEqual({ type: 'direction', direction }),
  );
  it('不接受 WASD', () => {
    for (const key of ['w', 'a', 's', 'd', 'W', 'A', 'S', 'D']) expect(commandFromKey(key)).toBeNull();
  });
  it('映射空格、R 和 M', () => {
    expect(commandFromKey(' ')).toEqual({ type: 'togglePause' });
    expect(commandFromKey('r')).toEqual({ type: 'restart' });
    expect(commandFromKey('M')).toEqual({ type: 'toggleMute' });
  });
  it('为受支持按键阻止浏览器默认行为', () => {
    const onCommand = vi.fn();
    const input = new KeyboardInput(window, onCommand);
    input.start();
    const event = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onCommand).toHaveBeenCalledOnce();
    input.stop();
  });
});
```

```ts
// src/game/clock.test.ts
import { describe, expect, it } from 'vitest';
import { FixedStepClock } from './clock';

describe('FixedStepClock', () => {
  it('累积时间并返回逻辑步数和插值比例', () => {
    const clock = new FixedStepClock();
    expect(clock.consume(75, 150)).toEqual({ steps: 0, alpha: 0.5 });
    expect(clock.consume(100, 150)).toEqual({ steps: 1, alpha: 25 / 150 });
  });
  it('限制单帧追赶步数，避免恢复页面时爆发更新', () => {
    const clock = new FixedStepClock(4);
    expect(clock.consume(2000, 100).steps).toBe(4);
  });
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`npm run test -- src/game/input.test.ts src/game/clock.test.ts`

预期：失败，提示输入模块和时钟模块不存在。

- [ ] **步骤 3：实现输入映射和可解绑监听器**

```ts
// src/game/input.ts
import type { Direction } from './types';

export type InputCommand =
  | { readonly type: 'direction'; readonly direction: Direction }
  | { readonly type: 'togglePause' }
  | { readonly type: 'restart' }
  | { readonly type: 'toggleMute' };

const DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
};

export const commandFromKey = (key: string): InputCommand | null => {
  const direction = DIRECTIONS[key];
  if (direction) return { type: 'direction', direction };
  if (key === ' ') return { type: 'togglePause' };
  if (key.toLowerCase() === 'r') return { type: 'restart' };
  if (key.toLowerCase() === 'm') return { type: 'toggleMute' };
  return null;
};

export class KeyboardInput {
  private readonly handleKey = (event: KeyboardEvent): void => {
    const command = commandFromKey(event.key);
    if (!command) return;
    event.preventDefault();
    this.onCommand(command);
  };

  constructor(
    private readonly target: Window,
    private readonly onCommand: (command: InputCommand) => void,
  ) {}

  start(): void { this.target.addEventListener('keydown', this.handleKey); }
  stop(): void { this.target.removeEventListener('keydown', this.handleKey); }
}
```

- [ ] **步骤 4：实现有追赶上限的固定节拍时钟**

```ts
// src/game/clock.ts
export interface ClockResult { readonly steps: number; readonly alpha: number }

export class FixedStepClock {
  private accumulatedMs = 0;
  constructor(private readonly maximumSteps = 4) {}

  consume(deltaMs: number, tickMs: number): ClockResult {
    this.accumulatedMs += Math.max(0, Math.min(deltaMs, tickMs * this.maximumSteps));
    let steps = 0;
    while (this.accumulatedMs >= tickMs && steps < this.maximumSteps) {
      this.accumulatedMs -= tickMs;
      steps += 1;
    }
    return { steps, alpha: Math.min(1, this.accumulatedMs / tickMs) };
  }

  reset(): void { this.accumulatedMs = 0; }
}
```

- [ ] **步骤 5：运行测试并提交**

运行：`npm run test -- src/game/input.test.ts src/game/clock.test.ts`

预期：全部通过。

```bash
git add src/game/input.ts src/game/input.test.ts src/game/clock.ts src/game/clock.test.ts
git commit -m "feat: 添加方向键输入与固定节拍时钟"
```

## 任务四：实现存储和合成音频适配器

**文件：**
- 新建：`src/adapters/storage.ts`
- 新建：`src/adapters/storage.test.ts`
- 新建：`src/adapters/audio.ts`

- [ ] **步骤 1：编写存储持久化和异常降级测试**

```ts
import { describe, expect, it } from 'vitest';
import { PreferenceStore } from './storage';

describe('PreferenceStore', () => {
  it('保存并读取最高分和静音偏好', () => {
    const store = new PreferenceStore(localStorage);
    store.write({ bestScore: 120, muted: true });
    expect(store.read()).toEqual({ bestScore: 120, muted: true });
  });
  it('损坏数据或存储异常时使用内存默认值', () => {
    const broken: Storage = {
      getItem: () => { throw new Error('禁止读取'); },
      setItem: () => { throw new Error('禁止写入'); },
      removeItem: () => undefined, clear: () => undefined, key: () => null, length: 0,
    };
    const store = new PreferenceStore(broken);
    expect(store.read()).toEqual({ bestScore: 0, muted: false });
    store.write({ bestScore: 30, muted: true });
    expect(store.read()).toEqual({ bestScore: 30, muted: true });
  });
});
```

- [ ] **步骤 2：确认测试失败**

运行：`npm run test -- src/adapters/storage.test.ts`

预期：失败，提示 `PreferenceStore` 不存在。

- [ ] **步骤 3：实现带内存回退的偏好存储**

```ts
// src/adapters/storage.ts
export interface Preferences { readonly bestScore: number; readonly muted: boolean }
const KEY = 'neon-snake-preferences-v1';
const DEFAULTS: Preferences = { bestScore: 0, muted: false };

const normalize = (value: unknown): Preferences => {
  if (!value || typeof value !== 'object') return DEFAULTS;
  const record = value as Record<string, unknown>;
  return {
    bestScore: typeof record.bestScore === 'number' && record.bestScore >= 0 ? record.bestScore : 0,
    muted: record.muted === true,
  };
};

export class PreferenceStore {
  private memory: Preferences = DEFAULTS;
  constructor(private readonly storage: Storage | null) {}

  read(): Preferences {
    try {
      const raw = this.storage?.getItem(KEY);
      if (raw) this.memory = normalize(JSON.parse(raw));
    } catch { /* 存储不可用时沿用当前会话内存值。 */ }
    return { ...this.memory };
  }

  write(next: Preferences): void {
    this.memory = normalize(next);
    try { this.storage?.setItem(KEY, JSON.stringify(this.memory)); }
    catch { /* 写入失败不应中断当前游戏。 */ }
  }
}
```

- [ ] **步骤 4：实现可静音的 Web Audio 合成器**

`src/adapters/audio.ts` 使用单个延迟创建的 `AudioContext`，并通过短促振荡器包络生成声音。公开接口固定为：

```ts
import type { GameEvent } from '../game/types';

export class SynthAudio {
  private context: AudioContext | null = null;
  private lastTurnAt = 0;
  constructor(private muted: boolean) {}

  setMuted(muted: boolean): void { this.muted = muted; }
  isMuted(): boolean { return this.muted; }

  async unlock(): Promise<void> {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
  }

  playEvent(event: GameEvent): void {
    if (this.muted || !this.context) return;
    if (event.type === 'foodEaten') this.tone(520, 760, 0.08, 'sine');
    if (event.type === 'speedChanged') this.tone(640, 1040, 0.14, 'triangle');
    if (event.type === 'gameOver') this.tone(180, 55, 0.28, 'sawtooth');
    if (event.type === 'completed') this.tone(520, 1320, 0.42, 'triangle');
  }

  playStart(): void { if (!this.muted && this.context) this.tone(260, 620, 0.12, 'triangle'); }
  playPause(): void { if (!this.muted && this.context) this.tone(300, 220, 0.06, 'square'); }
  playTurn(now = performance.now()): void {
    if (this.muted || !this.context || now - this.lastTurnAt < 45) return;
    this.lastTurnAt = now;
    this.tone(420, 480, 0.035, 'sine');
  }

  private tone(from: number, to: number, duration: number, type: OscillatorType): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
```

在 `unlock()` 外层调用处捕获初始化失败，使无音频环境仍可游戏。

- [ ] **步骤 5：运行测试并提交**

运行：`npm run test -- src/adapters/storage.test.ts && npm run build`

预期：存储测试和类型检查通过。

```bash
git add src/adapters
git commit -m "feat: 添加本地偏好与合成音效"
```

## 任务五：实现自适应视觉质量控制

**文件：**
- 新建：`src/render/quality.ts`
- 新建：`src/render/quality.test.ts`
- 新建：`src/render/theme.ts`

- [ ] **步骤 1：编写质量升降级失败测试**

```ts
import { describe, expect, it } from 'vitest';
import { QualityGovernor } from './quality';

describe('QualityGovernor', () => {
  it('持续超过帧预算时从高质量降级', () => {
    const governor = new QualityGovernor();
    for (let index = 0; index < 90; index += 1) governor.sample(18);
    expect(governor.level()).toBe('medium');
  });
  it('中质量下持续拥有高刷余量时恢复高质量', () => {
    const governor = new QualityGovernor('medium');
    for (let index = 0; index < 240; index += 1) governor.sample(7);
    expect(governor.level()).toBe('high');
  });
  it('减少动态效果时固定使用低质量且关闭震动', () => {
    const governor = new QualityGovernor('high', true);
    expect(governor.profile()).toMatchObject({ particleLimit: 24, shake: false, blurQuality: 1 });
  });
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`npm run test -- src/render/quality.test.ts`

预期：失败，提示质量控制器不存在。

- [ ] **步骤 3：实现滞回式质量控制器**

`src/render/quality.ts` 保存最近 90 帧均值：高质量均值超过 14 毫秒降为中等，中等超过 19 毫秒降为低；中等或低质量连续 240 帧低于 9 毫秒时提升一级。降级后清空样本，避免同一采样窗口连续跳级。

```ts
export type QualityLevel = 'low' | 'medium' | 'high';

export const QUALITY_PROFILES = {
  high: { particleLimit: 160, backgroundParticles: 72, blurQuality: 3, shake: true },
  medium: { particleLimit: 96, backgroundParticles: 40, blurQuality: 2, shake: true },
  low: { particleLimit: 24, backgroundParticles: 14, blurQuality: 1, shake: false },
} as const;

export class QualityGovernor {
  private current: QualityLevel;
  private samples: number[] = [];
  private fastFrameCount = 0;

  constructor(initial: QualityLevel = 'high', private readonly reducedMotion = false) {
    this.current = reducedMotion ? 'low' : initial;
  }

  sample(frameMs: number): void {
    if (this.reducedMotion) return;
    this.fastFrameCount = frameMs < 9 ? this.fastFrameCount + 1 : 0;
    if (this.fastFrameCount >= 240) {
      this.current = this.current === 'low' ? 'medium' : 'high';
      this.fastFrameCount = 0;
      this.samples = [];
      return;
    }
    this.samples.push(frameMs);
    if (this.samples.length < 90) return;
    const average = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    this.samples = [];
    if (this.current === 'high' && average > 14) this.current = 'medium';
    else if (this.current === 'medium' && average > 19) this.current = 'low';
  }

  level(): QualityLevel { return this.current; }
  profile(): (typeof QUALITY_PROFILES)[QualityLevel] {
    return QUALITY_PROFILES[this.reducedMotion ? 'low' : this.current];
  }
}
```

减少动态效果时 `profile()` 始终返回低质量配置，不根据帧时间升级。

- [ ] **步骤 4：集中定义霓虹主题参数**

```ts
// src/render/theme.ts
export const THEME = {
  background: 0x020611,
  board: 0x030817,
  grid: 0x1ceaff,
  cyan: 0x45f4ff,
  magenta: 0xe45bff,
  food: 0xff3b8d,
  white: 0xf1ffff,
  gridAlpha: 0.075,
  boardColumns: 32,
  boardRows: 24,
} as const;
```

- [ ] **步骤 5：运行测试并提交**

运行：`npm run test -- src/render/quality.test.ts`

预期：三个用例全部通过。

```bash
git add src/render
git commit -m "feat: 添加自适应视觉质量控制"
```

## 任务六：实现 PixiJS WebGL 场景和效果

**文件：**
- 新建：`src/render/particles.ts`
- 新建：`src/render/game-renderer.ts`

- [ ] **步骤 1：实现不在动画热路径创建对象的粒子池**

`src/render/particles.ts` 使用预先创建的 Pixi `Graphics` 对象，并维护以下粒子数据：`active`、`x`、`y`、`velocityX`、`velocityY`、`lifeMs`、`maximumLifeMs`、`color`。公开接口为：

```ts
export interface BurstOptions {
  readonly x: number; readonly y: number; readonly color: number; readonly count: number;
}

export class ParticlePool {
  constructor(parent: import('pixi.js').Container, capacity: number);
  burst(options: BurstOptions): void;
  update(deltaMs: number): void;
  setLimit(limit: number): void;
  clear(): void;
}
```

`burst()` 只激活空闲粒子；`update()` 原地更新位置、透明度和缩放；生命结束后隐藏对象并标记为空闲；`clear()` 隐藏全部粒子。每个粒子使用半径 2～5 像素的圆，并采用加色混合。

- [ ] **步骤 2：初始化 Pixi 应用和分层场景**

`src/render/game-renderer.ts` 的初始化必须使用 WebGL 偏好、透明画布、抗锯齿、自动密度和最高 2 倍设备像素比：

```ts
this.app = new Application();
await this.app.init({
  preference: 'webgl',
  backgroundAlpha: 0,
  antialias: true,
  autoDensity: true,
  resolution: Math.min(window.devicePixelRatio || 1, 2),
  resizeTo: this.host,
});
this.host.append(this.app.canvas);
```

根场景按顺序包含背景、棋盘、网格、蛇身辉光、蛇身实体、食物、粒子和冲击覆盖层。蛇身辉光层使用 `BlurFilter`，质量参数取自 `QualityGovernor.profile().blurQuality`。

- [ ] **步骤 3：实现响应式棋盘布局和静态背景**

每次容器尺寸变化时按以下公式计算棋盘：

```ts
const maximumWidth = Math.min(this.app.screen.width - 48, 960);
const maximumHeight = this.app.screen.height - 48;
const cellSize = Math.max(8, Math.floor(Math.min(maximumWidth / 32, maximumHeight / 24)));
this.boardWidth = cellSize * 32;
this.boardHeight = cellSize * 24;
this.boardX = Math.floor((this.app.screen.width - this.boardWidth) / 2);
this.boardY = Math.floor((this.app.screen.height - this.boardHeight) / 2);
```

网格仅在尺寸变化时重绘。背景使用深蓝径向层次和稀疏固定星点；网格线透明度为 `THEME.gridAlpha`，棋盘四角增加短青色定位线。

- [ ] **步骤 4：实现蛇身与食物的插值绘制**

渲染入口固定为：

```ts
render(previous: GameSnapshot, current: GameSnapshot, alpha: number, deltaMs: number): void
```

对当前每一节身体，使用上一快照相同索引的位置作为起点；新增尾节没有上一位置时使用上一快照最后一节。像素位置按 `start + (end - start) * alpha` 插值。蛇身实体使用可复用 `Graphics` 池，圆角方块从尾部品红渐变至头部青色；蛇头增加两枚深色眼点。辉光层复制相同位置并降低透明度。

食物绘制为白色核心、粉色外圈和两个随时间正弦缩放的低透明度圆环。网格坐标必须通过同一个 `cellToPixel(point)` 方法转换，避免效果层与规则层错位。

- [ ] **步骤 5：把游戏事件转换为特效**

- `foodEaten`：在食物位置生成 24 个青色与粉色粒子，并令网格透明度在 180 毫秒内从 0.22 回落至基础值。
- `speedChanged`：生成一圈向外扩张的青色描边，并在抬头显示层触发速度脉冲事件。
- `gameOver`：显示 120 毫秒低透明度粉色冲击闪光；允许动态效果时进行最大 8 像素、持续 220 毫秒的根场景震动，并在 120 毫秒内绘制六条交替偏移 ±6 像素的半透明水平故障切片。
- `completed`：生成不超过当前质量上限的双色粒子雨。

为避免重复触发，控制器每个逻辑节拍只调用一次 `handleEvents(events)`。渲染器公开接口最终固定为：

```ts
export interface RendererPort {
  init(): Promise<void>;
  render(previous: GameSnapshot, current: GameSnapshot, alpha: number, deltaMs: number): void;
  handleEvents(events: readonly GameEvent[]): void;
  setPaused(paused: boolean): void;
  reset(snapshot: GameSnapshot): void;
  destroy(): void;
}
```

- [ ] **步骤 6：加入帧采样和减少动态效果**

每一帧把 `deltaMs` 交给 `QualityGovernor.sample()`，质量等级变化时更新粒子上限和模糊质量。通过 `matchMedia('(prefers-reduced-motion: reduce)')` 初始化减少动态效果设置；此模式关闭震动、故障位移和背景粒子动画。

- [ ] **步骤 7：验证类型和生产构建并提交**

运行：`npm run build`

预期：PixiJS 类型检查和 Vite 生产构建通过；若 PixiJS 小版本 API 不同，只按已安装版本调整构造参数和绘图链式语法，不改变 `RendererPort` 或视觉行为。

```bash
git add src/render
git commit -m "feat: 实现霓虹 WebGL 游戏场景"
```

## 任务七：实现抬头显示、控制器和应用装配

**文件：**
- 新建：`src/ui/hud.ts`
- 新建：`src/controller/game-controller.ts`
- 修改：`src/main.ts`
- 修改：`src/styles.css`

- [ ] **步骤 1：创建可测试的中文界面结构**

`src/ui/hud.ts` 创建并持有以下带测试标识的节点：

```html
<main class="game-shell">
  <header class="hud">
    <section><span>分数</span><strong data-testid="score">00000</strong></section>
    <section><span>最高分</span><strong data-testid="best-score">00000</strong></section>
    <h1>贪吃蛇 // 霓虹</h1>
    <section><span>速度</span><strong data-testid="speed">× 1.0</strong></section>
  </header>
  <div class="canvas-host" data-testid="canvas-host"></div>
  <section class="overlay" data-testid="overlay" data-state="ready">
    <p class="eyebrow">系统待命</p><h2>按空格键开始</h2>
  </section>
  <footer><span>方向键移动</span><span>空格键暂停</span><span>R 重新开始</span><span>M 静音</span></footer>
  <button class="mute" data-testid="mute" type="button" aria-label="切换静音">声音：开</button>
</main>
```

公开 `update(snapshot, bestScore, muted)`，把分数补足五位、计算 `1 + foodCount / 25` 的显示速度倍率，并根据状态显示：`ready` 为“按空格键开始”、`paused` 为“已暂停”、`gameOver` 为“系统中断”、`completed` 为“棋盘已占满”。`playing` 时隐藏覆盖层。

构造函数接收 `onToggleMute` 回调，静音按钮点击时调用该回调；同时提供 `showRendererError(onRetry)` 和 `showSmallViewportHint(visible)`，避免入口文件直接操作内部节点。

- [ ] **步骤 2：编写控制器编排逻辑**

`src/controller/game-controller.ts` 持有引擎、输入、时钟、渲染器、抬头显示、存储和音频。每个动画帧执行：

```ts
const deltaMs = Math.min(250, timestamp - this.previousTimestamp);
this.previousTimestamp = timestamp;
const beforeFrame = this.engine.snapshot();
const clock = beforeFrame.status === 'playing'
  ? this.clock.consume(deltaMs, beforeFrame.tickMs)
  : { steps: 0, alpha: 0 };

let previous = this.previousSnapshot;
let events: GameEvent[] = [];
for (let index = 0; index < clock.steps; index += 1) {
  previous = this.engine.snapshot();
  events = [...events, ...this.engine.step()];
}
const current = this.engine.snapshot();
this.renderer.handleEvents(events);
this.renderer.render(previous, current, clock.alpha, deltaMs);
this.consumeEvents(events);
this.hud.update(current, this.preferences.bestScore, this.preferences.muted);
this.previousSnapshot = previous;
this.frameId = requestAnimationFrame(this.frame);
```

命令处理规则固定为：

- `direction`：仅在 `playing` 时交给引擎队列。
- `togglePause`：`ready` 时调用 `start()` 并播放开始音；`playing` 或 `paused` 时调用 `togglePause()`、播放暂停音，并重置时钟避免恢复时追赶。
- `restart`：只在 `paused`、`gameOver` 或 `completed` 时调用 `restart()`，随后重置渲染器和时钟。
- `toggleMute`：反转偏好、更新音频和存储。

有效方向入队时调用限频后的 `audio.playTurn()`。`consumeEvents(events)` 把每个事件交给音频；若当前分数高于已保存最高分，则立即更新内存偏好和 `PreferenceStore`，保证意外关闭页面前已经写入。

首次受支持的键盘操作和静音按钮点击都调用 `audio.unlock().catch(() => undefined)`。`visibilitychange` 或窗口 `blur` 时，如果正在游戏则自动暂停并更新界面；文档隐藏时取消后续动画帧，重新可见时重置时钟和时间戳后再请求动画帧，避免后台渲染和恢复追赶。

- [ ] **步骤 3：完成应用入口和 WebGL 错误覆盖层**

`src/main.ts` 创建界面、存储、音频、引擎、渲染器和控制器，按顺序初始化。渲染器初始化异常时，不启动控制器，并将覆盖层改为：

```html
<p class="eyebrow">渲染器不可用</p>
<h2>无法启动 WebGL</h2>
<p>请开启浏览器硬件加速后刷新页面。</p>
<button type="button" data-testid="retry">重新尝试</button>
```

重试按钮调用 `location.reload()`。小于 640×520 像素的视口显示非阻塞提示“建议使用桌面端获得完整体验”，但不重置当前游戏。

- [ ] **步骤 4：实现霓虹深空 CSS**

`src/styles.css` 必须实现以下可见结果：

- 全屏近黑深蓝径向背景、低透明度扫描线和稀疏星点。
- 最大宽度约 1100 像素的居中游戏框，青色半透明边框与柔和阴影。
- 顶部三段式抬头显示，分数使用等宽数字和青色辉光。
- 画布区域保持 4:3，覆盖层使用半透明深蓝背景与轻度毛玻璃。
- `ready`、`paused`、`gameOver`、`completed` 使用不同但克制的强调色。
- 键盘焦点具有清晰轮廓；按钮可通过键盘访问。
- 在 `@media (max-width: 720px)` 中隐藏中央标识、压缩间距并保留全部分数信息。
- 在 `@media (prefers-reduced-motion: reduce)` 中关闭 CSS 动画和过渡。

界面文字统一使用中文；代码注释仅使用中文。

- [ ] **步骤 5：运行全部单元测试、构建并提交**

运行：`npm run test && npm run build`

预期：全部单元测试通过，生产构建成功。

```bash
git add src/ui src/controller src/main.ts src/styles.css
git commit -m "feat: 装配完整游戏界面与控制流程"
```

## 任务八：添加浏览器验收、中文说明和视觉检查

**文件：**
- 新建：`e2e/game.spec.ts`
- 新建：`README.md`

- [ ] **步骤 1：安装 Chromium 测试浏览器**

运行：`npx playwright install chromium`

预期：Chromium 安装完成，退出码为 0。

- [ ] **步骤 2：编写失败的完整流程浏览器测试**

```ts
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('overlay')).toHaveAttribute('data-state', 'ready');
});

test('只能使用方向键移动，并可暂停、继续和重开', async ({ page }) => {
  await page.keyboard.press('Space');
  await expect(page.getByTestId('overlay')).toBeHidden();
  await page.keyboard.press('KeyW');
  await expect(page.getByTestId('overlay')).toBeHidden();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('overlay')).toHaveAttribute('data-state', 'paused');
  await page.keyboard.press('KeyR');
  await expect(page.getByTestId('overlay')).toHaveAttribute('data-state', 'ready');
});

test('静音和最高分偏好可以持久保存', async ({ page }) => {
  await page.getByTestId('mute').click();
  await expect(page.getByTestId('mute')).toHaveText(/声音：关/);
  await page.reload();
  await expect(page.getByTestId('mute')).toHaveText(/声音：关/);
});

test('失去页面焦点时自动暂停', async ({ page, context }) => {
  await page.keyboard.press('Space');
  const other = await context.newPage();
  await other.bringToFront();
  await page.bringToFront();
  await expect(page.getByTestId('overlay')).toHaveAttribute('data-state', 'paused');
});

test('桌面和小视口都保持棋盘可见', async ({ page }) => {
  await expect(page.locator('canvas')).toBeVisible();
  await page.setViewportSize({ width: 640, height: 520 });
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByText('建议使用桌面端获得完整体验')).toBeVisible();
});
```

- [ ] **步骤 3：运行浏览器测试并修正真实交互问题**

运行：`npm run test:e2e`

预期：四个 Chromium 用例全部通过。只修正应用行为、等待条件或稳定的测试标识，不使用固定长延时掩盖竞态。

- [ ] **步骤 4：编写中文项目说明**

`README.md` 必须包含：项目简介、Node.js 版本要求、`npm install`、`npm run dev`、方向键/空格/`R`/`M` 操作、`npm run test`、`npm run test:e2e`、`npm run build`、高刷新率说明、无触控支持说明、浏览器本地数据说明。

- [ ] **步骤 5：进行视觉和性能人工检查**

在 Chromium 中分别检查 1440×900、1024×768 和 640×520：

- 蛇、食物、网格和抬头显示始终可辨认。
- 进食粒子不遮住下一步路径。
- 碰撞闪光不产生长时间白屏。
- 浏览器性能面板中不出现持续增长的粒子对象。
- 60Hz 设备稳定跟随刷新率；高刷设备可用时，动画帧跟随 120Hz/144Hz。
- 模拟 `prefers-reduced-motion: reduce` 后无震动和故障位移。

- [ ] **步骤 6：提交浏览器验收和说明**

```bash
git add e2e README.md
git commit -m "test: 添加浏览器验收与中文使用说明"
```

## 任务九：最终回归与交付检查

**文件：**
- 可能修改：仅修改前述检查暴露出的具体文件

- [ ] **步骤 1：运行完整自动化检查**

运行：`npm run test && npm run build && npm run test:e2e`

预期：所有单元测试、TypeScript 检查、Vite 生产构建和 Chromium 验收测试均通过。

- [ ] **步骤 2：检查中文文档和代码注释规范**

运行：

```bash
rg -n "$(printf '%s' 'TO''DO|FIX''ME|T''BD|待''办|待''定')" README.md docs src e2e
rg -n "//|/\\*|<!--" src e2e
```

预期：没有占位符；所有实际代码注释均为中文。技术标识符、API 名称和依赖包名可以保留英文。

- [ ] **步骤 3：检查工作区和提交历史**

运行：`git status --short && git log --oneline --decorate -10`

预期：工作区干净；项目骨架、游戏引擎、输入时钟、适配器、质量控制、WebGL 场景、界面装配和浏览器验收分别有清晰提交。

- [ ] **步骤 4：在最终答复前执行完成度验证**

使用 `superpowers:verification-before-completion`，重新运行其要求的证据命令；只有在最新输出全部通过后才能宣称实现完成。
