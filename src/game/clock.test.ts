import { describe, expect, it } from 'vitest';

import { FixedStepClock } from './clock';

describe('固定节拍时钟', () => {
  it('累积不足一拍时返回插值比例，跨拍后保留余量', () => {
    const clock = new FixedStepClock();

    expect(clock.consume(75, 150)).toEqual({ steps: 0, alpha: 0.5 });
    expect(clock.consume(100, 150)).toEqual({ steps: 1, alpha: 25 / 150 });
  });

  it('单次最多追赶构造时指定的步数', () => {
    expect(new FixedStepClock(4).consume(2_000, 100).steps).toBe(4);
  });

  it('负增量不会让累积时间倒退', () => {
    const clock = new FixedStepClock();
    clock.consume(75, 150);

    expect(clock.consume(-50, 150)).toEqual({ steps: 0, alpha: 0.5 });
  });

  it('重置后清空累积时间', () => {
    const clock = new FixedStepClock();
    clock.consume(75, 150);
    clock.reset();

    expect(clock.consume(0, 150).alpha).toBe(0);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('拒绝无效最大步数 %s', (maximumSteps) => {
    expect(() => new FixedStepClock(maximumSteps)).toThrow(
      '最大步数必须为正安全整数',
    );
  });

  it.each([Number.NaN, 0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    '拒绝无效节拍间隔 %s',
    (tickMs) => {
      expect(() => new FixedStepClock().consume(0, tickMs)).toThrow(
        '节拍间隔必须为正有限数',
      );
    },
  );

  it('非数增量按零处理', () => {
    const clock = new FixedStepClock();
    clock.consume(50, 100);

    expect(clock.consume(Number.NaN, 100)).toEqual({ steps: 0, alpha: 0.5 });
  });

  it('无限增量按最大追赶窗口处理', () => {
    expect(new FixedStepClock(4).consume(Number.POSITIVE_INFINITY, 100)).toEqual({
      steps: 4,
      alpha: 0,
    });
  });

  it('极大节拍下的无限增量不会污染累积余量', () => {
    const clock = new FixedStepClock(4);
    const tickMs = Number.MAX_VALUE;

    expect(clock.consume(tickMs / 2, tickMs).alpha).toBeCloseTo(0.5);

    const catchUp = clock.consume(Number.POSITIVE_INFINITY, tickMs);
    expect(catchUp.steps).toBe(4);
    expect(catchUp.alpha).toBeCloseTo(0.5);

    const settled = clock.consume(0, tickMs);
    expect(settled.steps).toBe(0);
    expect(Number.isFinite(settled.alpha)).toBe(true);
    expect(settled.alpha).toBeCloseTo(0.5);
  });

  it('缩短节拍时保留超过单帧预算的旧积压', () => {
    const clock = new FixedStepClock(1);

    expect(clock.consume(149, 150)).toEqual({
      steps: 0,
      alpha: 149 / 150,
    });
    expect(clock.consume(0, 65)).toEqual({ steps: 1, alpha: 1 });

    const remainingBacklog = clock.consume(0, 65);
    expect(remainingBacklog.steps).toBe(1);
    expect(remainingBacklog.alpha).toBeCloseTo(19 / 65);
  });

  it('旧积压耗尽追赶预算时仍保留本帧新增时间', () => {
    const clock = new FixedStepClock(1);
    clock.consume(149, 150);

    expect(clock.consume(10, 65)).toEqual({ steps: 1, alpha: 1 });

    const remainingBacklog = clock.consume(0, 65);
    expect(remainingBacklog.steps).toBe(1);
    expect(remainingBacklog.alpha).toBeCloseTo(29 / 65);
  });

  it('延长节拍时按新节拍换算旧余量', () => {
    const clock = new FixedStepClock();

    expect(clock.consume(64, 65)).toEqual({ steps: 0, alpha: 64 / 65 });
    expect(clock.consume(0, 150)).toEqual({ steps: 0, alpha: 64 / 150 });
  });

  it('新增时间恰好耗尽追赶预算时保留旧余量', () => {
    const clock = new FixedStepClock(4);
    clock.consume(50, 100);

    expect(clock.consume(400, 100)).toEqual({ steps: 4, alpha: 0.5 });
  });

  it('无限增量耗尽追赶预算后保留既有亚节拍余量', () => {
    const clock = new FixedStepClock(4);
    clock.consume(50, 100);

    expect(clock.consume(Number.POSITIVE_INFINITY, 100)).toEqual({
      steps: 4,
      alpha: 0.5,
    });
    expect(clock.consume(0, 100)).toEqual({ steps: 0, alpha: 0.5 });
  });

  it('无限增量遇到缩短节拍时不会清空旧积压', () => {
    const clock = new FixedStepClock(1);
    clock.consume(149, 150);

    expect(clock.consume(Number.POSITIVE_INFINITY, 65)).toEqual({
      steps: 1,
      alpha: 1,
    });

    const remainingBacklog = clock.consume(0, 65);
    expect(remainingBacklog.steps).toBe(1);
    expect(remainingBacklog.alpha).toBe(1);

    const finalRemainder = clock.consume(0, 65);
    expect(finalRemainder.steps).toBe(1);
    expect(finalRemainder.alpha).toBeCloseTo(19 / 65);
  });
});
