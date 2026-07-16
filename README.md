# 霓虹贪吃蛇

一个使用 TypeScript、PixiJS 和 WebGL 制作的桌面端贪吃蛇游戏。游戏包含固定步长逻辑、键盘控制、程序化音效、最高分与静音偏好持久化，以及面向不同窗口尺寸的响应式界面。

## 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`
- npm（随 Node.js 安装）
- 支持 WebGL 的现代桌面浏览器

## 安装与运行

```bash
npm install
npm run dev
```

开发服务器启动后，打开终端中显示的本地地址即可开始游戏。

## 操作

| 按键 | 功能 |
| --- | --- |
| 方向键 | 控制移动方向 |
| `Space` | 开始、暂停或继续 |
| `R` | 在暂停或本局结束后重新开始 |
| `M` | 开启或关闭声音 |

页脚中的“声音”按钮也可以切换静音。游戏目前仅支持键盘操作，不提供触控控制，建议使用桌面端浏览器。

## 检查与构建

```bash
npm run test       # 运行 Vitest 单元测试
npm run test:e2e   # 运行 Playwright Chromium 浏览器验收
npm run build      # 类型检查并生成生产构建
npm run check      # 依次运行单元测试和生产构建
```

首次运行浏览器验收前，如本机尚未安装 Playwright 的 Chromium，请执行：

```bash
npx playwright install chromium
```

## 刷新率与性能目标

游戏逻辑使用固定步长更新，渲染循环会适配浏览器刷新节奏。体验目标面向 120Hz 和 144Hz 显示器，同时将 60Hz 作为最低流畅体验基线。实际刷新率和帧率由显示器、浏览器、系统负载及显卡驱动决定；自动化无头浏览器测试不验证真实的 120Hz 或 144Hz 输出。

## 本地数据

最高分与静音状态保存在浏览器 `localStorage` 的 `neon-snake-preferences-v1` 项中，数据格式为：

```json
{
  "bestScore": 120,
  "muted": false
}
```

这些数据仅存于当前浏览器配置中，不会同步到云端。清除站点数据会重置最高分和静音偏好。

## 无障碍与故障排查

页面遵循系统的“减少动态效果”（`prefers-reduced-motion`）设置：开启后会缩短并停止循环的 CSS 动画。

如果页面显示“无法启动 WebGL”：

1. 在浏览器设置中开启硬件加速，然后完全重启浏览器。
2. 更新浏览器和显卡驱动，并检查浏览器的 GPU/WebGL 状态页面。
3. 避免在禁用图形加速的远程桌面、虚拟机或受限浏览器策略下运行。
4. 仍无法启动时，尝试更换支持 WebGL 的现代桌面浏览器。

## 项目结构

```text
.
├── e2e/                    # Playwright 浏览器验收
├── src/
│   ├── adapters/           # 音频与本地存储适配器
│   ├── controller/         # 游戏流程和浏览器事件协调
│   ├── game/               # 纯游戏引擎、输入与固定步长时钟
│   ├── render/             # PixiJS WebGL 渲染、粒子和质量控制
│   ├── ui/                 # HUD 与状态遮罩
│   ├── bootstrap.ts        # 运行时装配与异常降级
│   ├── main.ts             # 浏览器入口
│   └── styles.css          # 响应式视觉样式
├── index.html
├── playwright.config.ts
└── vite.config.ts
```
