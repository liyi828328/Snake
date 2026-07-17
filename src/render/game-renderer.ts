import {
  Application,
  BlurFilter,
  Container,
  Graphics,
} from 'pixi.js';

import { DEFAULT_HEIGHT, DEFAULT_WIDTH } from '../game/config';
import type {
  GameEvent,
  GameSnapshot,
  Point,
  RandomSource,
} from '../game/types';
import { EffectTimeline, gameOverEffectDurations } from './effects';
import { ParticlePool } from './particles';
import type { ParticleBurst } from './particles';
import { QUALITY_PROFILES, QualityGovernor, selectProfile } from './quality';
import { THEME } from './theme';

export interface BoardLayout {
  readonly cell: number;
  readonly boardWidth: number;
  readonly boardHeight: number;
  readonly x: number;
  readonly y: number;
}

interface MutablePoint {
  x: number;
  y: number;
}

export interface RendererPort {
  init(): Promise<void>;
  render(
    previous: GameSnapshot,
    current: GameSnapshot,
    alpha: number,
    deltaMs: number,
  ): void;
  handleEvents(events: readonly GameEvent[]): void;
  setPaused(paused: boolean): void;
  reset(snapshot: GameSnapshot): void;
  destroy(): void;
}

export interface GameRendererOptions {
  readonly reducedMotion?: boolean;
  readonly governor?: QualityGovernor;
  readonly random?: RandomSource;
  readonly applicationFactory?: () => Application;
}

interface SegmentPair {
  readonly body: Graphics;
  readonly glow: Graphics;
  readonly logical: MutablePoint;
  readonly pixel: MutablePoint;
}

interface FoodVisual {
  readonly container: Container;
  readonly core: Graphics;
  readonly outer: Graphics;
  readonly firstRing: Graphics;
  readonly secondRing: Graphics;
  readonly pixel: MutablePoint;
}

export function calculateBoardLayout(
  screenWidth: number,
  screenHeight: number,
  columns: number = DEFAULT_WIDTH,
  rows: number = DEFAULT_HEIGHT,
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
  const cell = Math.max(
    0,
    Math.min(30, maximumWidth / safeColumns, maximumHeight / safeRows),
  );
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

export function interpolateBody(
  previous: GameSnapshot,
  current: GameSnapshot,
  alpha: number,
): Point[] {
  const interpolation = Number.isFinite(alpha)
    ? Math.min(1, Math.max(0, alpha))
    : 0;
  const previousTail = previous.body.at(-1);

  return current.body.map((currentPoint, index) => {
    const previousPoint = previous.body[index] ?? previousTail ?? currentPoint;
    return {
      x: previousPoint.x + (currentPoint.x - previousPoint.x) * interpolation,
      y: previousPoint.y + (currentPoint.y - previousPoint.y) * interpolation,
    };
  });
}

export function interpolatePointInto<T extends MutablePoint>(
  previous: Point,
  current: Point,
  alpha: number,
  target: T,
): T {
  const interpolation = Number.isFinite(alpha)
    ? Math.min(1, Math.max(0, alpha))
    : 0;
  target.x = previous.x + (current.x - previous.x) * interpolation;
  target.y = previous.y + (current.y - previous.y) * interpolation;
  return target;
}

export class GameRenderer implements RendererPort {
  private app: Application | null = null;
  private initPromise: Promise<void> | null = null;
  private scene!: Container;
  private backgroundLayer!: Container;
  private boardLayer!: Container;
  private gridLayer!: Container;
  private snakeGlowLayer!: Container;
  private snakeLayer!: Container;
  private foodLayer!: Container;
  private particlesLayer!: Container;
  private impactLayer!: Container;
  private backgroundGraphic!: Graphics;
  private boardGraphic!: Graphics;
  private gridGraphic!: Graphics;
  private speedRing!: Graphics;
  private flash!: Graphics;
  private headEyes!: Graphics;
  private readonly glitchSlices: Graphics[] = [];
  private readonly segments: SegmentPair[] = [];
  private readonly foodVisuals: FoodVisual[] = [];
  private readonly eventLogical = { x: 0, y: 0 };
  private readonly eventPixel = { x: 0, y: 0 };
  private particlePool: ParticlePool | null = null;
  private glowFilter: BlurFilter | null = null;
  private layout: BoardLayout | null = null;
  private screenWidth = -1;
  private screenHeight = -1;
  private boardColumns = DEFAULT_WIDTH;
  private boardRows = DEFAULT_HEIGHT;
  private backgroundParticleCount = -1;
  private particleLimit = -1;
  private blurQuality = -1;
  private elapsedMs = 0;
  private readonly effects = new EffectTimeline();
  private paused = false;
  private destroyed = false;
  private reducedMotion: boolean;
  private readonly governor: QualityGovernor;
  private readonly random: RandomSource;
  private readonly applicationFactory: () => Application;
  private readonly motionQuery: MediaQueryList | null;

  constructor(
    private readonly host: HTMLElement,
    options: GameRendererOptions = {},
  ) {
    this.random = options.random ?? Math.random;
    this.applicationFactory = options.applicationFactory ?? (() => new Application());
    this.motionQuery = options.reducedMotion === undefined
      && typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    this.reducedMotion = options.reducedMotion
      ?? this.motionQuery?.matches
      ?? false;
    this.governor = options.governor
      ?? new QualityGovernor('high', false);
    this.motionQuery?.addEventListener('change', this.handleMotionPreference);
  }

  init(): Promise<void> {
    if (this.destroyed) {
      return Promise.reject(new Error('渲染器已销毁'));
    }
    if (this.app) {
      return Promise.resolve();
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    let app: Application;
    try {
      app = this.applicationFactory();
    } catch (error) {
      return Promise.reject(error);
    }

    const initPromise = this.initialize(app);
    this.initPromise = initPromise;
    void initPromise.then(
      () => {
        if (this.initPromise === initPromise) {
          this.initPromise = null;
        }
      },
      () => {
        if (this.initPromise === initPromise) {
          this.initPromise = null;
        }
      },
    );
    return initPromise;
  }

  private async initialize(app: Application): Promise<void> {
    try {
      await app.init({
        preference: ['webgl'],
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(
          typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
          2,
        ),
        resizeTo: this.host,
        autoStart: false,
      });

      if (this.destroyed) {
        throw new Error('渲染器已销毁');
      }

      app.canvas.setAttribute('role', 'img');
      app.canvas.setAttribute('aria-label', '霓虹贪吃蛇游戏画面');
      app.canvas.style.display = 'block';
      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      this.host.appendChild(app.canvas);
      this.app = app;

      this.createLayers();
      this.applyQuality();
      this.ensureLayout();
      app.render();
    } catch (error) {
      this.cleanupApplication(app);
      throw error;
    }
  }

  render(
    previous: GameSnapshot,
    current: GameSnapshot,
    alpha: number,
    deltaMs: number,
  ): void {
    if (!this.app || this.destroyed) {
      return;
    }

    const validDelta = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
    if (validDelta > 0 && !this.reducedMotion) {
      this.governor.sample(validDelta);
    }
    this.applyQuality();
    this.ensureLayout(current.width, current.height);

    if (validDelta > 0) {
      this.advanceEffects(validDelta);
    }

    this.drawSnake(previous, current, alpha);
    this.drawFoods(current);
    this.drawEffects();
    this.app.render();
  }

  handleEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      if (event.type === 'foodEaten') {
        this.effects.start('gridPulse', 180);
        this.emitFoodParticles(event.at);
        continue;
      }

      if (event.type === 'speedChanged') {
        this.effects.start('speedPulse', 300);
        this.host.dispatchEvent(new CustomEvent('snake:speed-pulse'));
        continue;
      }

      if (event.type === 'gameOver') {
        const durations = gameOverEffectDurations(this.reducedMotion);
        this.effects.start('flash', durations.flashMs);
        this.effects.start('shake', durations.shakeMs);
        this.effects.start('glitch', durations.glitchMs);
        continue;
      }

      this.emitCompletionRain();
    }
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.scene?.position.set(0, 0);
    }
  }

  reset(snapshot: GameSnapshot): void {
    if (!this.app || this.destroyed) {
      return;
    }

    this.particlePool?.clear();
    this.elapsedMs = 0;
    this.effects.reset();
    this.paused = snapshot.status === 'paused';
    this.scene.position.set(0, 0);
    for (const segment of this.segments) {
      segment.body.visible = false;
      segment.glow.visible = false;
    }
    this.headEyes.visible = false;
    this.render(snapshot, snapshot, 1, 0);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.motionQuery?.removeEventListener('change', this.handleMotionPreference);
    const app = this.app;
    if (app) {
      this.cleanupApplication(app);
    }
  }

  private cleanupApplication(app: Application): void {
    if (this.app === app) {
      this.app = null;
    }

    try {
      this.particlePool?.destroy();
    } catch {
      // 清理继续执行，确保 Application 仍会被销毁。
    }
    this.particlePool = null;

    if (this.glowFilter) {
      try {
        if (this.snakeGlowLayer) {
          this.snakeGlowLayer.filters = null;
        }
        this.glowFilter.destroy();
      } catch {
        // 清理继续执行，确保 canvas 与 Application 仍会回收。
      }
      this.glowFilter = null;
    }

    try {
      if (app.canvas.parentElement === this.host) {
        this.host.removeChild(app.canvas);
      }
    } catch {
      // Application.destroy 仍会尝试移除 view。
    }
    try {
      app.destroy({ removeView: true }, { children: true });
    } catch {
      // destroy 必须幂等且不掩盖初始化阶段的原始异常。
    }

    this.segments.length = 0;
    this.foodVisuals.length = 0;
    this.glitchSlices.length = 0;
    this.layout = null;
    this.screenWidth = -1;
    this.screenHeight = -1;
    this.backgroundParticleCount = -1;
    this.particleLimit = -1;
    this.blurQuality = -1;
  }

  private readonly handleMotionPreference = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
    if (this.reducedMotion) {
      this.effects.stop('shake');
      this.effects.stop('glitch');
      this.scene?.position.set(0, 0);
    }
    this.applyQuality();
  };

  private createLayers(): void {
    if (!this.app) {
      return;
    }

    this.scene = new Container();
    this.backgroundLayer = new Container();
    this.boardLayer = new Container();
    this.gridLayer = new Container();
    this.snakeGlowLayer = new Container();
    this.snakeLayer = new Container();
    this.foodLayer = new Container();
    this.particlesLayer = new Container();
    this.impactLayer = new Container();
    this.scene.addChild(
      this.backgroundLayer,
      this.boardLayer,
      this.gridLayer,
      this.snakeGlowLayer,
      this.snakeLayer,
      this.foodLayer,
      this.particlesLayer,
      this.impactLayer,
    );
    this.app.stage.addChild(this.scene);

    this.backgroundGraphic = new Graphics();
    this.boardGraphic = new Graphics();
    this.gridGraphic = new Graphics();
    this.speedRing = new Graphics();
    this.flash = new Graphics();
    this.headEyes = new Graphics();
    this.backgroundLayer.addChild(this.backgroundGraphic);
    this.boardLayer.addChild(this.boardGraphic);
    this.gridLayer.addChild(this.gridGraphic);
    this.snakeLayer.addChild(this.headEyes);
    this.impactLayer.addChild(this.speedRing, this.flash);

    for (let index = 0; index < 6; index += 1) {
      const slice = new Graphics();
      slice.visible = false;
      slice.blendMode = 'add';
      this.glitchSlices.push(slice);
      this.impactLayer.addChild(slice);
    }

    this.glowFilter = new BlurFilter({
      strength: 8,
      quality: this.activeProfile().blurQuality,
    });
    this.snakeGlowLayer.filters = [this.glowFilter];
    this.particlePool = new ParticlePool(
      this.particlesLayer,
      QUALITY_PROFILES.high.particleLimit,
      this.random,
    );
  }

  private activeProfile(): (typeof QUALITY_PROFILES)[keyof typeof QUALITY_PROFILES] {
    return selectProfile(this.reducedMotion, this.governor.profile);
  }

  private applyQuality(): void {
    if (!this.app || !this.particlePool || !this.glowFilter) {
      return;
    }

    const profile = this.activeProfile();
    if (profile.particleLimit !== this.particleLimit) {
      this.particleLimit = profile.particleLimit;
      this.particlePool.setLimit(profile.particleLimit);
    }
    if (profile.blurQuality !== this.blurQuality) {
      this.blurQuality = profile.blurQuality;
      this.glowFilter.quality = profile.blurQuality;
    }
    if (profile.backgroundParticles !== this.backgroundParticleCount) {
      this.backgroundParticleCount = profile.backgroundParticles;
      this.redrawBackground();
    }
  }

  private ensureLayout(
    columns: number = this.boardColumns,
    rows: number = this.boardRows,
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

  private redrawBackground(): void {
    if (!this.app || !this.backgroundGraphic) {
      return;
    }

    const { width, height } = this.app.screen;
    const centerX = width / 2;
    const centerY = height * 0.42;
    const radius = Math.max(width, height);
    this.backgroundGraphic
      .clear()
      .rect(-8, -8, width + 16, height + 16)
      .fill(THEME.background)
      .circle(centerX, centerY, radius * 0.82)
      .fill({ color: 0x03132d, alpha: 0.48 })
      .circle(centerX, centerY, radius * 0.6)
      .fill({ color: 0x062049, alpha: 0.3 })
      .circle(centerX, centerY, radius * 0.38)
      .fill({ color: 0x0a2a59, alpha: 0.2 });

    const vignetteDepth = Math.max(24, Math.min(width, height) * 0.1);
    for (let layer = 0; layer < 4; layer += 1) {
      const depth = vignetteDepth * (1 - layer * 0.18);
      const alpha = 0.075 + layer * 0.025;
      this.backgroundGraphic
        .rect(-8, -8, depth, height + 16)
        .fill({ color: 0x01030a, alpha })
        .rect(width - depth, -8, depth + 8, height + 16)
        .fill({ color: 0x01030a, alpha })
        .rect(-8, -8, width + 16, depth)
        .fill({ color: 0x01030a, alpha })
        .rect(-8, height - depth, width + 16, depth + 8)
        .fill({ color: 0x01030a, alpha });
    }

    for (let index = 0; index < this.backgroundParticleCount; index += 1) {
      const x = ((index * 73 + 17) % 997) / 997 * width;
      const y = ((index * 151 + 41) % 991) / 991 * height;
      const radius = 0.55 + (index % 3) * 0.35;
      this.backgroundGraphic
        .circle(x, y, radius)
        .fill({
          color: index % 4 === 0 ? THEME.magenta : THEME.cyan,
          alpha: 0.18 + (index % 5) * 0.035,
        });
    }
  }

  private redrawBoardAndGrid(): void {
    if (!this.layout || !this.boardGraphic || !this.gridGraphic) {
      return;
    }

    const layout = this.layout;
    this.boardGraphic
      .clear()
      .roundRect(
        layout.x,
        layout.y,
        layout.boardWidth,
        layout.boardHeight,
        Math.max(8, layout.cell * 0.45),
      )
      .fill({ color: THEME.board, alpha: 0.98 })
      .stroke({ color: THEME.cyan, alpha: 0.16, width: 1.5 });
    this.drawCornerLocators();

    this.gridGraphic.clear();
    for (let column = 1; column < this.boardColumns; column += 1) {
      const x = layout.x + column * layout.cell;
      this.gridGraphic
        .moveTo(x, layout.y)
        .lineTo(x, layout.y + layout.boardHeight);
    }
    for (let row = 1; row < this.boardRows; row += 1) {
      const y = layout.y + row * layout.cell;
      this.gridGraphic
        .moveTo(layout.x, y)
        .lineTo(layout.x + layout.boardWidth, y);
    }
    this.gridGraphic.stroke({ color: THEME.grid, width: 1 });
    this.updateGridAlpha();
  }

  private drawCornerLocators(): void {
    if (!this.layout) {
      return;
    }

    const layout = this.layout;
    const length = Math.max(12, layout.cell * 0.85);
    const inset = Math.max(4, layout.cell * 0.18);
    const left = layout.x + inset;
    const right = layout.x + layout.boardWidth - inset;
    const top = layout.y + inset;
    const bottom = layout.y + layout.boardHeight - inset;
    this.boardGraphic
      .moveTo(left, top + length)
      .lineTo(left, top)
      .lineTo(left + length, top)
      .moveTo(right - length, top)
      .lineTo(right, top)
      .lineTo(right, top + length)
      .moveTo(left, bottom - length)
      .lineTo(left, bottom)
      .lineTo(left + length, bottom)
      .moveTo(right - length, bottom)
      .lineTo(right, bottom)
      .lineTo(right, bottom - length)
      .stroke({ color: THEME.cyan, alpha: 0.72, width: 2 });
  }

  private redrawImpactGeometry(): void {
    if (!this.app || !this.layout) {
      return;
    }

    this.flash
      .clear()
      .rect(-8, -8, this.app.screen.width + 16, this.app.screen.height + 16)
      .fill(THEME.food);
    this.flash.visible = false;

    this.speedRing
      .clear()
      .circle(0, 0, this.layout.cell)
      .stroke({
        color: THEME.cyan,
        alpha: 1,
        width: Math.max(1.5, this.layout.cell * 0.08),
      });
    this.speedRing.position.set(
      this.layout.x + this.layout.boardWidth / 2,
      this.layout.y + this.layout.boardHeight / 2,
    );
    this.speedRing.visible = false;

    const sliceHeight = Math.max(2, this.layout.cell * 0.12);
    for (let index = 0; index < this.glitchSlices.length; index += 1) {
      const slice = this.glitchSlices[index]!;
      slice
        .clear()
        .rect(0, 0, this.layout.boardWidth, sliceHeight)
        .fill({
          color: index % 2 === 0 ? THEME.magenta : THEME.cyan,
          alpha: 0.32,
        });
      slice.y = this.layout.y
        + this.layout.boardHeight * ((index + 1) / (this.glitchSlices.length + 1));
    }
  }

  private redrawFoodGeometry(): void {
    if (!this.layout) {
      return;
    }

    for (const visual of this.foodVisuals) {
      this.redrawFoodVisual(visual);
    }
  }

  private redrawFoodVisual(visual: FoodVisual): void {
    if (!this.layout) {
      return;
    }

    const core = this.layout.cell * 0.11;
    const outer = this.layout.cell * 0.23;
    visual.core
      .clear()
      .circle(0, 0, core)
      .fill(THEME.white);
    visual.outer
      .clear()
      .circle(0, 0, outer)
      .stroke({
        color: THEME.white,
        alpha: 0.92,
        width: Math.max(1.5, this.layout.cell * 0.07),
      });
    visual.firstRing
      .clear()
      .circle(0, 0, this.layout.cell)
      .stroke({ color: THEME.white, alpha: 1, width: 1.5 });
    visual.secondRing
      .clear()
      .circle(0, 0, this.layout.cell)
      .stroke({ color: THEME.white, alpha: 1, width: 1 });
  }

  private ensureFoodVisualCount(count: number): void {
    if (!this.layout) {
      return;
    }

    while (this.foodVisuals.length < count) {
      const container = new Container();
      const firstRing = new Graphics();
      const secondRing = new Graphics();
      const outer = new Graphics();
      const core = new Graphics();
      firstRing.blendMode = 'add';
      secondRing.blendMode = 'add';
      container.addChild(firstRing, secondRing, outer, core);
      container.visible = false;
      this.foodLayer.addChild(container);
      const visual = {
        container,
        core,
        outer,
        firstRing,
        secondRing,
        pixel: { x: 0, y: 0 },
      };
      this.foodVisuals.push(visual);
      this.redrawFoodVisual(visual);
    }
  }

  private ensureSegmentCount(count: number): void {
    if (!this.layout) {
      return;
    }

    while (this.segments.length < count) {
      const glow = new Graphics();
      const body = new Graphics();
      glow.blendMode = 'add';
      this.snakeGlowLayer.addChild(glow);
      this.snakeLayer.addChild(body);
      const segment = {
        body,
        glow,
        logical: { x: 0, y: 0 },
        pixel: { x: 0, y: 0 },
      };
      this.segments.push(segment);
      this.redrawSegment(segment);
    }
    this.snakeLayer.addChild(this.headEyes);
  }

  private redrawSegmentGeometry(): void {
    for (const segment of this.segments) {
      this.redrawSegment(segment);
    }
    this.redrawHeadEyes();
  }

  private redrawSegment(segment: SegmentPair): void {
    if (!this.layout) {
      return;
    }

    const size = this.layout.cell * 0.76;
    const glowSize = this.layout.cell * 0.84;
    segment.body
      .clear()
      .roundRect(-size / 2, -size / 2, size, size, size * 0.28)
      .fill(0xffffff);
    segment.glow
      .clear()
      .roundRect(-glowSize / 2, -glowSize / 2, glowSize, glowSize, glowSize * 0.3)
      .fill(0xffffff);
  }

  private redrawHeadEyes(): void {
    if (!this.layout || !this.headEyes) {
      return;
    }

    const eyeX = this.layout.cell * 0.2;
    const eyeY = this.layout.cell * 0.14;
    const eyeRadius = Math.max(1.2, this.layout.cell * 0.055);
    this.headEyes
      .clear()
      .circle(eyeX, -eyeY, eyeRadius)
      .circle(eyeX, eyeY, eyeRadius)
      .fill(0x061222);
  }

  private drawSnake(
    previous: GameSnapshot,
    current: GameSnapshot,
    alpha: number,
  ): void {
    if (!this.layout) {
      return;
    }

    const interpolation = Number.isFinite(alpha)
      ? Math.min(1, Math.max(0, alpha))
      : 0;
    const previousTail = previous.body.at(-1);
    this.ensureSegmentCount(current.body.length);
    const denominator = Math.max(1, current.body.length - 1);

    for (let index = 0; index < this.segments.length; index += 1) {
      const segment = this.segments[index]!;
      const currentPoint = current.body[index];
      if (!currentPoint) {
        segment.body.visible = false;
        segment.glow.visible = false;
        continue;
      }

      const previousPoint = previous.body[index] ?? previousTail ?? currentPoint;
      segment.logical.x = previousPoint.x
        + (currentPoint.x - previousPoint.x) * interpolation;
      segment.logical.y = previousPoint.y
        + (currentPoint.y - previousPoint.y) * interpolation;
      this.cellToPixel(segment.logical, segment.pixel);
      const tailProgress = index / denominator;
      const color = mixColor(THEME.cyan, THEME.magenta, tailProgress);
      segment.body.position.set(segment.pixel.x, segment.pixel.y);
      segment.body.tint = color;
      segment.body.alpha = index === 0 ? 1 : 0.9;
      segment.body.scale.set(index === 0 ? 1.08 : 1);
      segment.body.visible = true;
      segment.glow.position.set(segment.pixel.x, segment.pixel.y);
      segment.glow.tint = color;
      segment.glow.alpha = index === 0 ? 0.5 : 0.28;
      segment.glow.scale.set(index === 0 ? 1.12 : 1);
      segment.glow.visible = true;
    }

    const headPixel = this.segments[0]?.pixel;
    if (!current.body[0] || !headPixel) {
      this.headEyes.visible = false;
      return;
    }
    this.headEyes.position.set(headPixel.x, headPixel.y);
    this.headEyes.rotation = directionRotation(current.direction);
    this.headEyes.visible = true;
  }

  private drawFoods(snapshot: GameSnapshot): void {
    if (!this.layout) {
      return;
    }

    this.ensureFoodVisualCount(snapshot.foods.length);
    const pulseTime = this.reducedMotion ? 0 : this.elapsedMs;
    const firstPulse = (Math.sin(pulseTime * 0.006) + 1) / 2;
    const secondPulse = (Math.sin(pulseTime * 0.006 + Math.PI) + 1) / 2;
    const bonusPhase = (this.elapsedMs % 1_400) / 1_400;
    const secondBonusPhase = (bonusPhase + 0.5) % 1;

    for (let index = 0; index < snapshot.foods.length; index += 1) {
      const food = snapshot.foods[index]!;
      const visual = this.foodVisuals[index]!;
      const tint = food.kind === 'bonus' ? THEME.bonusFood : THEME.food;
      this.cellToPixel(food, visual.pixel);
      visual.container.position.set(visual.pixel.x, visual.pixel.y);
      visual.core.tint = tint;
      visual.outer.tint = tint;
      visual.firstRing.tint = tint;
      visual.secondRing.tint = tint;

      if (food.kind === 'bonus') {
        if (this.reducedMotion) {
          visual.firstRing.scale.set(0.58);
          visual.firstRing.alpha = 0.5;
          visual.secondRing.scale.set(0.78);
          visual.secondRing.alpha = 0.3;
        } else {
          visual.firstRing.scale.set(0.3 + bonusPhase * 0.8);
          visual.firstRing.alpha = 0.62 * (1 - bonusPhase);
          visual.secondRing.scale.set(0.3 + secondBonusPhase * 0.8);
          visual.secondRing.alpha = 0.5 * (1 - secondBonusPhase);
        }
      } else {
        visual.firstRing.scale.set(0.3 + firstPulse * 0.12);
        visual.firstRing.alpha = 0.44 * (1 - firstPulse);
        visual.secondRing.scale.set(0.36 + secondPulse * 0.12);
        visual.secondRing.alpha = 0.32 * (1 - secondPulse);
      }
      visual.container.visible = true;
    }

    for (
      let index = snapshot.foods.length;
      index < this.foodVisuals.length;
      index += 1
    ) {
      this.foodVisuals[index]!.container.visible = false;
    }
  }

  private emitFoodParticles(at: Point): void {
    if (!this.particlePool) {
      return;
    }
    this.ensureLayout();
    if (!this.layout) {
      return;
    }

    this.cellToPixel(at, this.eventPixel);
    this.particlePool.burst({
      x: this.eventPixel.x,
      y: this.eventPixel.y,
      color: THEME.cyan,
      count: 12,
    });
    this.particlePool.burst({
      x: this.eventPixel.x,
      y: this.eventPixel.y,
      color: THEME.magenta,
      count: 12,
    });
  }

  private emitCompletionRain(): void {
    if (!this.particlePool) {
      return;
    }
    this.ensureLayout();
    if (!this.layout) {
      return;
    }

    const count = this.activeProfile().particleLimit;
    const bursts: ParticleBurst[] = [];
    for (let index = 0; index < count; index += 1) {
      this.eventLogical.x = (index + this.random() * 0.8)
        / count * this.boardColumns - 0.5;
      this.eventLogical.y = -this.random() * 3 - 0.5;
      this.cellToPixel(this.eventLogical, this.eventPixel);
      bursts.push({
        x: this.eventPixel.x,
        y: this.eventPixel.y,
        color: index % 2 === 0 ? THEME.cyan : THEME.magenta,
        count: 1,
        mode: 'rain',
      });
    }
    this.particlePool.replaceBursts(bursts);
  }

  private cellToPixel(point: Point, target: MutablePoint): void {
    if (!this.layout) {
      target.x = 0;
      target.y = 0;
      return;
    }
    target.x = this.layout.x + (point.x + 0.5) * this.layout.cell;
    target.y = this.layout.y + (point.y + 0.5) * this.layout.cell;
  }

  private advanceEffects(deltaMs: number): void {
    this.effects.advance(deltaMs, this.paused);
    if (this.paused) {
      return;
    }

    this.elapsedMs += deltaMs;
    this.particlePool?.update(deltaMs);

    const profile = this.activeProfile();
    const shakeMs = this.effects.remaining('shake');
    if (!this.reducedMotion && profile.shake && shakeMs > 0) {
      const strength = Math.min(8, 8 * (shakeMs / 220));
      this.scene.position.set(
        (this.random() * 2 - 1) * strength,
        (this.random() * 2 - 1) * strength,
      );
    } else {
      this.scene.position.set(0, 0);
    }
  }

  private drawEffects(): void {
    if (!this.layout) {
      return;
    }

    this.updateGridAlpha();
    const flashMs = this.effects.remaining('flash');
    this.flash.visible = flashMs > 0;
    this.flash.alpha = 0.16 * (flashMs / 120);

    const speedPulseMs = this.effects.remaining('speedPulse');
    if (speedPulseMs > 0) {
      const progress = 1 - speedPulseMs / 300;
      this.speedRing.position.set(
        this.layout.x + this.layout.boardWidth / 2,
        this.layout.y + this.layout.boardHeight / 2,
      );
      this.speedRing.scale.set(1.1 + progress * 7.5);
      this.speedRing.alpha = 0.7 * (1 - progress);
      this.speedRing.visible = true;
    } else {
      this.speedRing.visible = false;
    }

    const glitchMs = this.effects.remaining('glitch');
    const glitchActive = glitchMs > 0;
    const phase = Math.floor((120 - glitchMs) / 20);
    for (let index = 0; index < this.glitchSlices.length; index += 1) {
      const slice = this.glitchSlices[index]!;
      slice.visible = glitchActive;
      slice.alpha = 0.65 * (glitchMs / 120);
      const offset = this.reducedMotion
        ? 0
        : (phase + index) % 2 === 0 ? 6 : -6;
      slice.x = this.layout.x + offset;
    }
  }

  private updateGridAlpha(): void {
    if (!this.gridGraphic) {
      return;
    }
    const progress = this.effects.remaining('gridPulse') / 180;
    this.gridGraphic.alpha = THEME.gridAlpha
      + (0.22 - THEME.gridAlpha) * progress;
  }
}

function mixColor(start: number, end: number, amount: number): number {
  const progress = Math.min(1, Math.max(0, amount));
  const startRed = (start >> 16) & 0xff;
  const startGreen = (start >> 8) & 0xff;
  const startBlue = start & 0xff;
  const endRed = (end >> 16) & 0xff;
  const endGreen = (end >> 8) & 0xff;
  const endBlue = end & 0xff;
  const red = Math.round(startRed + (endRed - startRed) * progress);
  const green = Math.round(startGreen + (endGreen - startGreen) * progress);
  const blue = Math.round(startBlue + (endBlue - startBlue) * progress);
  return (red << 16) | (green << 8) | blue;
}

function directionRotation(direction: GameSnapshot['direction']): number {
  if (direction === 'down') {
    return Math.PI / 2;
  }
  if (direction === 'left') {
    return Math.PI;
  }
  if (direction === 'up') {
    return -Math.PI / 2;
  }
  return 0;
}
