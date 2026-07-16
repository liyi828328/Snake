import type { GameSnapshot, GameStatus } from '../game/types';

export interface HudView {
  readonly canvasHost: HTMLElement;
  update(snapshot: GameSnapshot, bestScore: number, muted: boolean): void;
  showRendererError(onRetry: () => void): void;
  showSmallViewportHint(visible: boolean): void;
  pulseSpeed(): void;
  destroy(): void;
}

interface OverlayCopy {
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
}

const OVERLAY_COPY: Readonly<Record<Exclude<GameStatus, 'playing'>, OverlayCopy>> = {
  ready: {
    eyebrow: '系统待命',
    title: '按空格键开始',
    detail: '穿过霓虹网格，收集每一个能量核心。',
  },
  paused: {
    eyebrow: '信号冻结',
    title: '已暂停',
    detail: '信号已冻结，按空格键继续。',
  },
  gameOver: {
    eyebrow: '连接中断',
    title: '系统中断',
    detail: '连接已中断，按 R 重新开始。',
  },
  completed: {
    eyebrow: '全域点亮',
    title: '棋盘已占满',
    detail: '整片网格已被点亮，按 R 再来一局。',
  },
};

function formatScore(score: number): string {
  return Math.max(0, Math.trunc(score)).toString().padStart(5, '0');
}

export class Hud implements HudView {
  readonly canvasHost: HTMLElement;

  private readonly ownerDocument: Document;
  private readonly score: HTMLElement;
  private readonly bestScore: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly overlayEyebrow: HTMLElement;
  private readonly overlayTitle: HTMLElement;
  private readonly overlayDetail: HTMLElement;
  private readonly muteButton: HTMLButtonElement;
  private readonly viewportHint: HTMLElement;
  private pulseTimer: ReturnType<typeof setTimeout> | null = null;
  private retryButton: HTMLButtonElement | null = null;
  private retryHandler: (() => void) | null = null;
  private destroyed = false;

  private readonly handleMuteClick = (): void => {
    if (!this.destroyed) {
      this.onToggleMute();
    }
  };

  constructor(
    root: HTMLElement,
    private readonly onToggleMute: () => void,
  ) {
    this.ownerDocument = root.ownerDocument;
    root.innerHTML = `
      <main class="game-shell">
        <header class="hud" aria-label="游戏状态">
          <section class="hud__scores" aria-label="分数">
            <div class="hud__score-item">
              <span class="hud__label">分数</span>
              <output class="hud__number" data-testid="score">00000</output>
            </div>
            <div class="hud__score-item">
              <span class="hud__label">最高分</span>
              <output class="hud__number" data-testid="best-score">00000</output>
            </div>
          </section>
          <div class="hud__identity">
            <p class="hud__eyebrow">霓虹网格 // 在线</p>
            <h1>贪吃蛇 // 霓虹</h1>
          </div>
          <section class="hud__speed-panel" aria-label="速度">
            <span class="hud__label">速度</span>
            <output class="hud__speed" data-testid="speed">× 1.0</output>
          </section>
        </header>

        <section class="arena" aria-label="游戏区域">
          <div class="canvas-host" data-testid="canvas-host"></div>
          <div class="game-overlay" data-testid="overlay" data-state="ready" role="status" aria-live="polite">
            <div class="game-overlay__panel">
              <p class="game-overlay__eyebrow">系统待命</p>
              <h2>按空格键开始</h2>
              <p class="game-overlay__detail">穿过霓虹网格，收集每一个能量核心。</p>
            </div>
          </div>
        </section>

        <p class="viewport-hint" data-testid="viewport-hint" role="note" hidden>
          建议使用桌面端获得完整体验
        </p>

        <footer class="game-footer">
          <p>方向键移动/空格键暂停/R重新开始/M静音</p>
          <button class="mute-button" data-testid="mute" type="button" aria-label="切换静音" aria-pressed="false">
            声音：开
          </button>
        </footer>
      </main>
    `;

    this.canvasHost = this.requireElement(root, '[data-testid="canvas-host"]');
    this.score = this.requireElement(root, '[data-testid="score"]');
    this.bestScore = this.requireElement(root, '[data-testid="best-score"]');
    this.speed = this.requireElement(root, '[data-testid="speed"]');
    this.overlay = this.requireElement(root, '[data-testid="overlay"]');
    this.overlayEyebrow = this.requireElement(root, '.game-overlay__eyebrow');
    this.overlayTitle = this.requireElement(root, '.game-overlay h2');
    this.overlayDetail = this.requireElement(root, '.game-overlay__detail');
    this.muteButton = this.requireElement<HTMLButtonElement>(root, '[data-testid="mute"]');
    this.viewportHint = this.requireElement(root, '[data-testid="viewport-hint"]');
    this.muteButton.addEventListener('click', this.handleMuteClick);
  }

  update(snapshot: GameSnapshot, bestScore: number, muted: boolean): void {
    this.setText(this.score, formatScore(snapshot.score));
    this.setText(this.bestScore, formatScore(bestScore));
    this.setText(this.speed, `× ${(1 + snapshot.foodCount / 25).toFixed(1)}`);
    this.setText(this.muteButton, muted ? '声音：关' : '声音：开');
    this.setAttribute(this.muteButton, 'aria-pressed', String(muted));

    this.setAttribute(this.overlay, 'data-state', snapshot.status);
    if (snapshot.status === 'playing') {
      this.setHidden(this.overlay, true);
      return;
    }

    this.clearRetryListener();
    const copy = OVERLAY_COPY[snapshot.status];
    this.setText(this.overlayEyebrow, copy.eyebrow);
    this.setText(this.overlayTitle, copy.title);
    this.setText(this.overlayDetail, copy.detail);
    this.setHidden(this.overlay, false);
  }

  showRendererError(onRetry: () => void): void {
    this.clearRetryListener();
    this.overlay.dataset.state = 'rendererError';
    this.overlayEyebrow.textContent = '渲染器不可用';
    this.overlayTitle.textContent = '无法启动 WebGL';
    this.overlayDetail.textContent = '请开启浏览器硬件加速后刷新页面。';

    const retryButton = this.ownerDocument.createElement('button');
    retryButton.className = 'retry-button';
    retryButton.dataset.testid = 'retry';
    retryButton.type = 'button';
    retryButton.textContent = '重新尝试';

    const handler = (): void => {
      retryButton.disabled = true;
      onRetry();
    };
    retryButton.addEventListener('click', handler, { once: true });
    this.overlayDetail.after(retryButton);
    this.retryButton = retryButton;
    this.retryHandler = handler;
    this.overlay.hidden = false;
  }

  showSmallViewportHint(visible: boolean): void {
    this.viewportHint.hidden = !visible;
  }

  pulseSpeed(): void {
    if (this.destroyed) {
      return;
    }
    if (this.pulseTimer !== null) {
      clearTimeout(this.pulseTimer);
    }
    this.speed.classList.remove('is-pulsing');
    // 触发布局读取以便连续的速度事件能重新开始动画。
    void this.speed.offsetWidth;
    this.speed.classList.add('is-pulsing');
    this.pulseTimer = setTimeout(() => {
      this.speed.classList.remove('is-pulsing');
      this.pulseTimer = null;
    }, 300);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.muteButton.removeEventListener('click', this.handleMuteClick);
    this.clearRetryListener();
    if (this.pulseTimer !== null) {
      clearTimeout(this.pulseTimer);
      this.pulseTimer = null;
    }
    this.speed.classList.remove('is-pulsing');
  }

  private clearRetryListener(): void {
    if (this.retryButton && this.retryHandler) {
      this.retryButton.removeEventListener('click', this.retryHandler);
    }
    this.retryButton?.remove();
    this.retryButton = null;
    this.retryHandler = null;
  }

  private setText(element: HTMLElement, value: string): void {
    if (element.textContent !== value) {
      element.textContent = value;
    }
  }

  private setAttribute(element: HTMLElement, name: string, value: string): void {
    if (element.getAttribute(name) !== value) {
      element.setAttribute(name, value);
    }
  }

  private setHidden(element: HTMLElement, hidden: boolean): void {
    if (element.hidden !== hidden) {
      element.hidden = hidden;
    }
  }

  private requireElement<T extends HTMLElement = HTMLElement>(
    root: HTMLElement,
    selector: string,
  ): T {
    const element = root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`HUD 缺少元素：${selector}`);
    }
    return element;
  }
}
