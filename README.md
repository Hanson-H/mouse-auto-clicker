# 鼠标连点器 (Mouse Auto Clicker)

一个轻量、跨应用可用的 Windows 鼠标连点器，基于 **Electron + Vue 3** 构建。界面为 iOS 风格（深浅双主题），全部控件手写实现，无第三方组件库依赖。

## 功能特性

- **定时连点**：设置点击间隔（最小 10ms），按热键启动/暂停
- **鼠标点击**：左键 / 右键，单击 / 双击
- **点击位置**：跟随鼠标光标，或固定位置（支持 3 秒倒计时拾取屏幕坐标）
- **键盘连点**：固定 F 键（与鼠标模式互斥）
- **自定义热键**：启动 / 暂停可分别录制（相同键时"按一下启动、再按停止"）
- **深浅主题**：iOS systemBlue 配色，明暗自动跟随系统亦可手动切换
- **管理员自动提权**：检测到非管理员时自动以管理员身份重启（UIPI 兼容，确保 SendInput 对管理员窗口生效）
- **单实例运行**：重复启动会聚焦已有窗口

## 技术栈

| 层 | 技术 |
|---|---|
| 界面 | Vue 3 + Vite（无组件库，手写 Segmented / 步进器 / 按钮） |
| 桌面 | Electron 33 |
| 鼠标模拟 | koffi FFI 调用 Windows `SendInput` |
| 定时精度 | 绝对时间戳补偿 + `winmm timeBeginPeriod(1)` |
| 打包 | electron-builder（NSIS 安装包） |
| 字体 | Inter + MiSans（woff2 内嵌） |

## 开发

要求：Node.js 18+

```bash
# 安装依赖
npm install

# 渲染层开发（Vite HMR）
npm run dev

# 启动 Electron（需先构建 UI 或同时运行 dev server）
npm start
```

## 构建

```bash
# 渲染层构建（产物 renderer/dist）
npm run build:ui

# 生成安装包（推荐；含应用锁检测，失败自动重试）
npm run dist:safe

# 仅生成免安装目录（dist/win-unpacked）
npm run pack
```

> 打包前请关闭正在运行的「鼠标连点器」实例，否则 `dist/win-unpacked` 会被锁定导致打包失败。

## 配置

应用设置保存在系统 userData 目录的 `config.json`，可通过界面重置为默认值。

## 目录结构

```
├── main.js                 # Electron 主进程（窗口/热键/鼠标模拟/提权）
├── preload.js              # 预加载脚本（安全桥接）
├── renderer/               # 渲染层（Vue 3）
│   ├── index.html
│   └── src/App.vue         # 单页应用
│   └── src/style.css       # 样式（CSS 变量双主题）
├── scripts/safe-pack.js    # 防呆打包脚本
└── dist/                   # 构建产物
```

## 注意事项

- 短间隔连点（1000ms 以下）建议优先配合「双击」与较长间隔使用；请勿用于违反任何应用或游戏服务条款的场景。
- 首次运行可能触发 UAC 提权提示（用于管理员窗口兼容），属预期行为。
- 应用默认禁用 Electron 内置菜单（按 Alt 不会弹出 File/Edit 栏）。

## License

MIT
