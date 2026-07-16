import { SynthAudio } from './adapters/audio';
import { PreferenceStore } from './adapters/storage';
import { GameController } from './controller/game-controller';
import type {
  AudioPort,
  GameControllerOptions,
} from './controller/game-controller';
import { SnakeEngine } from './game/engine';
import type { RendererPort } from './render/game-renderer';
import { Hud } from './ui/hud';

export type ControllerRuntime = Pick<
  GameController,
  'start' | 'destroy' | 'toggleMute'
>;

export interface BootstrapRuntime {
  cleanup(): void;
}

export interface AudioContextHost {
  readonly AudioContext?: typeof AudioContext;
  readonly webkitAudioContext?: typeof AudioContext;
}

export interface BootstrapGameOptions {
  readonly window?: Window;
  readonly document?: Document;
  readonly root: HTMLElement;
  readonly rendererFactory?: (host: HTMLElement) => RendererPort;
  readonly rendererLoader?: (host: HTMLElement) => Promise<RendererPort>;
  readonly controllerFactory?: (
    dependencies: GameControllerOptions,
  ) => ControllerRuntime;
  readonly reload?: () => void;
  readonly storage?: Storage | null;
  readonly audioContextFactory?: () => AudioContext;
}

export function availableStorage(
  target: Pick<Window, 'localStorage'> = window,
): Storage | null {
  try {
    return target.localStorage;
  } catch {
    return null;
  }
}

export function createAudioContext(
  target: object = window,
): AudioContext {
  const audioContextHost = target as AudioContextHost;
  const AudioContextConstructor = audioContextHost.AudioContext
    ?? audioContextHost.webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error('当前浏览器不支持音频播放');
  }
  return new AudioContextConstructor();
}

export async function bootstrapGame(
  options: BootstrapGameOptions,
): Promise<BootstrapRuntime> {
  const targetWindow = options.window ?? window;
  const targetDocument = options.document ?? document;
  const reload = options.reload ?? (() => targetWindow.location.reload());

  let controller: ControllerRuntime | null = null;
  let renderer: RendererPort | null = null;
  let disposed = false;
  let listenersRegistered = false;
  const hud = new Hud(options.root, () => controller?.toggleMute());

  const updateViewportHint = (): void => {
    hud.showSmallViewportHint(
      targetWindow.innerWidth < 640 || targetWindow.innerHeight < 520,
    );
  };
  const handleSpeedPulse = (): void => {
    hud.pulseSpeed();
  };
  const removeRuntimeListeners = (): void => {
    if (!listenersRegistered) {
      return;
    }
    listenersRegistered = false;
    targetWindow.removeEventListener('resize', updateViewportHint);
    targetWindow.removeEventListener('beforeunload', cleanup);
    hud.canvasHost.removeEventListener('snake:speed-pulse', handleSpeedPulse);
  };
  const cleanup = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    removeRuntimeListeners();
    try {
      if (controller) {
        controller.destroy();
      } else {
        renderer?.destroy();
      }
    } finally {
      controller = null;
      renderer = null;
      hud.destroy();
    }
  };

  try {
    const storage = options.storage === undefined
      ? availableStorage(targetWindow)
      : options.storage;
    const store = new PreferenceStore(storage);
    const preferences = store.read();
    const audio: AudioPort = new SynthAudio(
      preferences.muted,
      options.audioContextFactory ?? (() => createAudioContext(targetWindow)),
    );
    const engine = new SnakeEngine();
    renderer = options.rendererFactory
      ? options.rendererFactory(hud.canvasHost)
      : await (options.rendererLoader ?? (async (host) => {
        const { GameRenderer } = await import('./render/game-renderer');
        return new GameRenderer(host);
      }))(hud.canvasHost);
    await renderer.init();
    controller = (options.controllerFactory ?? ((dependencies) => (
      new GameController(dependencies)
    )))({
      engine,
      renderer,
      hud,
      store,
      audio,
      window: targetWindow,
      document: targetDocument,
    });
    controller.start();

    listenersRegistered = true;
    targetWindow.addEventListener('resize', updateViewportHint);
    targetWindow.addEventListener('beforeunload', cleanup);
    hud.canvasHost.addEventListener('snake:speed-pulse', handleSpeedPulse);
    updateViewportHint();
  } catch {
    removeRuntimeListeners();
    if (controller) {
      try {
        controller.destroy();
      } catch {
        // 启动异常时仍继续显示可重试错误页。
      }
      controller = null;
      renderer = null;
    } else if (renderer) {
      try {
        renderer.destroy();
      } catch {
        // 销毁异常不能覆盖原始启动失败。
      }
      renderer = null;
    }
    if (!disposed) {
      hud.showRendererError(reload);
    }
  }

  return { cleanup };
}
