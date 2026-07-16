import { Container, Graphics } from 'pixi.js';

import type { RandomSource } from '../game/types';

interface ParticleState {
  readonly graphic: Graphics;
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifeMs: number;
  maximumLifeMs: number;
  color: number;
  fresh: boolean;
}

export interface ParticleBurst {
  readonly x: number;
  readonly y: number;
  readonly color: number;
  readonly count: number;
  readonly mode?: 'burst' | 'rain';
}

export class ParticlePool {
  private readonly particles: ParticleState[];
  private limit: number;

  constructor(
    private readonly parent: Container,
    capacity: number,
    private readonly random: RandomSource = Math.random,
  ) {
    const safeCapacity = Number.isFinite(capacity)
      ? Math.max(0, Math.floor(capacity))
      : 0;
    this.limit = safeCapacity;
    this.particles = Array.from({ length: safeCapacity }, () => {
      const graphic = new Graphics()
        .circle(0, 0, this.randomBetween(2, 5))
        .fill(0xffffff);
      graphic.blendMode = 'add';
      graphic.visible = false;
      this.parent.addChild(graphic);

      return {
        graphic,
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        lifeMs: 0,
        maximumLifeMs: 0,
        color: 0xffffff,
        fresh: false,
      };
    });
  }

  burst({ x, y, color, count, mode = 'burst' }: ParticleBurst): void {
    let remaining = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

    for (let index = 0; index < this.limit && remaining > 0; index += 1) {
      const particle = this.particles[index]!;
      if (particle.active) {
        continue;
      }

      const speed = this.randomBetween(45, 145);
      const maximumLifeMs = mode === 'rain'
        ? this.randomBetween(650, 1_200)
        : this.randomBetween(280, 720);
      const radius = this.randomBetween(2, 5);
      const angle = this.random() * Math.PI * 2;

      particle.active = true;
      particle.x = x;
      particle.y = y;
      particle.vx = mode === 'rain'
        ? this.randomBetween(-18, 18)
        : Math.cos(angle) * speed;
      particle.vy = mode === 'rain'
        ? this.randomBetween(70, 180)
        : Math.sin(angle) * speed;
      particle.lifeMs = maximumLifeMs;
      particle.maximumLifeMs = maximumLifeMs;
      particle.color = color;
      particle.fresh = true;

      particle.graphic
        .clear()
        .circle(0, 0, radius)
        .fill(color);
      particle.graphic.position.set(x, y);
      particle.graphic.scale.set(1);
      particle.graphic.alpha = 1;
      particle.graphic.visible = true;
      remaining -= 1;
    }
  }

  replaceBursts(bursts: readonly ParticleBurst[]): void {
    this.clear();
    for (const burst of bursts) {
      this.burst(burst);
    }
  }

  update(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      return;
    }

    const deltaSeconds = deltaMs / 1_000;
    for (let index = 0; index < this.limit; index += 1) {
      const particle = this.particles[index]!;
      if (!particle.active) {
        continue;
      }
      if (particle.fresh) {
        particle.fresh = false;
        continue;
      }

      particle.lifeMs -= deltaMs;
      if (particle.lifeMs <= 0) {
        this.deactivate(particle);
        continue;
      }

      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      particle.vy += 55 * deltaSeconds;

      const progress = particle.lifeMs / particle.maximumLifeMs;
      particle.graphic.position.set(particle.x, particle.y);
      particle.graphic.alpha = progress;
      particle.graphic.scale.set(0.45 + progress * 0.55);
    }
  }

  setLimit(limit: number): void {
    const nextLimit = Number.isFinite(limit)
      ? Math.min(this.particles.length, Math.max(0, Math.floor(limit)))
      : 0;

    if (nextLimit < this.limit) {
      for (let index = nextLimit; index < this.particles.length; index += 1) {
        this.deactivate(this.particles[index]!);
      }
    }
    this.limit = nextLimit;
  }

  clear(): void {
    for (const particle of this.particles) {
      this.deactivate(particle);
    }
  }

  destroy(): void {
    for (const particle of this.particles) {
      this.parent.removeChild(particle.graphic);
      particle.graphic.destroy();
      particle.active = false;
    }
    this.particles.length = 0;
    this.limit = 0;
  }

  private deactivate(particle: ParticleState): void {
    particle.active = false;
    particle.fresh = false;
    particle.lifeMs = 0;
    particle.graphic.visible = false;
  }

  private randomBetween(minimum: number, maximum: number): number {
    return minimum + this.random() * (maximum - minimum);
  }
}
