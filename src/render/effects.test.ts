import { describe, expect, it } from 'vitest';

import { EffectTimeline, gameOverEffectDurations } from './effects';

describe('特效时间线', () => {
  it('新事件首帧保持完整时长并从下一帧开始老化', () => {
    const timeline = new EffectTimeline();
    timeline.start('gridPulse', 180);

    timeline.advance(1_000, false);
    expect(timeline.remaining('gridPulse')).toBe(180);

    timeline.advance(100, false);
    expect(timeline.remaining('gridPulse')).toBe(80);
  });

  it('暂停期间既不扣时长也不消耗新事件的首帧', () => {
    const timeline = new EffectTimeline();
    timeline.start('gridPulse', 180);

    timeline.advance(1_000, true);
    expect(timeline.remaining('gridPulse')).toBe(180);

    timeline.advance(100, false);
    expect(timeline.remaining('gridPulse')).toBe(180);
    timeline.advance(100, false);
    expect(timeline.remaining('gridPulse')).toBe(80);
    timeline.advance(1_000, true);
    expect(timeline.remaining('gridPulse')).toBe(80);
  });

  it('减少动态效果时游戏结束不启动故障切片', () => {
    expect(gameOverEffectDurations(true)).toEqual({
      flashMs: 120,
      shakeMs: 0,
      glitchMs: 0,
    });
    expect(gameOverEffectDurations(false)).toEqual({
      flashMs: 120,
      shakeMs: 220,
      glitchMs: 120,
    });
  });
});
