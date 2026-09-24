// -*- coding: utf-8 -*-
// 鼠标连点器 - Electron 版 主进程
// 功能：Win32 SendInput 模拟点击、自定义启动/暂停全局快捷键、配置持久化
const { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme, Menu, Tray, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const koffi = require('koffi');

// ----------------------------------------------------------------------------
// Win32 API（koffi FFI，等价于 Python 版的 ctypes）
// ----------------------------------------------------------------------------
const user32 = koffi.load('user32.dll');

const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
// x64 下 INPUT = DWORD type(4) + padding(4) + MOUSEINPUT(32)，共 40 字节
const INPUT = koffi.struct('INPUT', {
  type: 'uint32',
  _pad: 'uint32',
  dx: 'int32',
  dy: 'int32',
  mouseData: 'uint32',
  dwFlags: 'uint32',
  time: 'uint32',
  _pad2: 'uint32',
  dwExtraInfo: 'uint64',
});

const SendInput = user32.func('int SendInput(int cInputs, INPUT *pInputs, int cbSize)');
// 键盘模拟走 keybd_event（标量参数，无 struct 布局风险；内部即 SendInput 封装）
const keybd_event = user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)');
const GetCursorPos = user32.func('int GetCursorPos(_Out_ POINT *lpPoint)');
const SetCursorPos = user32.func('int SetCursorPos(int X, int Y)');

// 定时器精度控制：连点时提升分辨率到 1ms（消除 setTimeout 短间隔量化误差），
// 停止时恢复默认——避免未连点时持续抬高系统定时器中断频率、白耗 CPU
let timeBeginPeriodFn = null;
let timeEndPeriodFn = null;
try {
  const winmm = koffi.load('winmm.dll');
  timeBeginPeriodFn = winmm.func('uint32 timeBeginPeriod(uint32 uPeriod)');
  timeEndPeriodFn = winmm.func('uint32 timeEndPeriod(uint32 uPeriod)');
} catch (e) { /* 忽略：非关键，不影响主流程 */ }

function setTimerPrecision(on) {
  try {
    if (on) { if (timeBeginPeriodFn) timeBeginPeriodFn(1); }
    else { if (timeEndPeriodFn) timeEndPeriodFn(1); }
  } catch (e) { /* 静默 */ }
}

// 状态提示音：kernel32 Beep（同步阻塞 ~40-90ms，仅启停瞬间调用，无感知）
let beepFn = null;
try {
  const kernel32 = koffi.load('kernel32.dll');
  beepFn = kernel32.func('bool Beep(uint32 dwFreq, uint32 dwDuration)');
} catch (e) { beepFn = null; }

function playBeep(freq, dur) {
  try { beepFn(freq, dur); } catch (e) { /* 静默失败 */ }
}

function statusSound(start) {
  if (!cfg || cfg.soundOn === false) return;
  if (beepFn) {
    if (start) { playBeep(660, 35); playBeep(880, 45); } // 升调双音：启动
    else { playBeep(440, 50); }                            // 低音：停止
  }
}

const INPUT_MOUSE = 0;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const KEYEVENTF_KEYUP = 0x0002;
const VK_F = 0x46; // 字母 f 键的虚拟键码

function sendMouse(flags) {
  SendInput(1, { type: INPUT_MOUSE, dwFlags: flags }, koffi.sizeof(INPUT));
}

function sendKey(vk) {
  // 单击模式：down → up（keybd_event 标量参数，规避 koffi struct 布局问题）
  keybd_event(vk, 0, 0, 0);
  keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
}

function doClick(x, y, button, double) {
  if (x !== null && y !== null) SetCursorPos(x, y);
  const down = button === 'right' ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
  const up = button === 'right' ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;
  sendMouse(down);
  sendMouse(up);
  if (double) {
    sendMouse(down);
    sendMouse(up);
  }
}

function getCursorPos() {
  const pt = {};
  GetCursorPos(pt);
  return { x: pt.x, y: pt.y };
}

// ----------------------------------------------------------------------------
// 配置持久化
// ----------------------------------------------------------------------------
const DEFAULT_CFG = {
  interval_ms: 100,
  simType: 'mouse',      // mouse / keyboard
  mode: 'follow',        // follow / fixed
  pos_x: 500,
  pos_y: 400,
  button: 'left',        // left / right
  double: false,
  startHotkey: 'F6',     // 启动连点快捷键
  stopHotkey: 'F7',      // 暂停连点快捷键
  theme: 'dark',         // dark / light
  soundOn: true,         // 启动/停止提示音
  showStatusbar: true,   // 显示置顶状态栏
  hideStatusbarWhenStopped: false, // 已停止时隐藏状态栏（仅运行中显示）
  statusbarOpacity: 0.2, // 状态栏背景不透明度挡位（20/40/60/80%）
  statusbarPos: null,    // 状态栏位置 {x, y}（拖动后记忆）
};

let cfg = { ...DEFAULT_CFG };
let cfgPath = null;

function loadConfig() {
  cfgPath = path.join(app.getPath('userData'), 'config.json');
  try {
    Object.assign(cfg, JSON.parse(fs.readFileSync(cfgPath, 'utf-8')));
  } catch (e) { /* 首次运行，使用默认配置 */ }
}

function saveConfig() {
  try {
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) { /* 忽略写盘失败 */ }
}

// ----------------------------------------------------------------------------
// 点击引擎
// ----------------------------------------------------------------------------
let running = false;
let clickCount = 0;
let timer = null;
let mainWindow = null;
let tray = null;
let statusWindow = null;  // 置顶状态栏窗口
let statusDragging = false;    // 拖动中标志（app-region: drag 由 move 事件驱动）
let statusDragEndTimer = null; // 拖动结束防抖 timer
let dragPaused = false;   // 拖动期间临时暂停连点（不改 running、不响提示音）
let nextTickAt = 0; // 下一次点击的绝对时间戳（ms），用于消除 setTimeout 累积漂移
let runStartedAt = 0; // 本次运行开始时间戳（ms），0 表示未运行

// ----------------------------------------------------------------------------
// 托盘状态图标（闲置灰 / 运行绿），随启停联动
// ----------------------------------------------------------------------------
function createTray() {
  try {
    const idleImg = nativeImage.createFromPath(path.join(__dirname, 'tray-idle.png'));
    const runImg = nativeImage.createFromPath(path.join(__dirname, 'tray-running.png'));
    tray = new Tray(running ? runImg : idleImg);
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    const ctxMenu = Menu.buildFromTemplate([
      { label: '显示主界面', click: () => mainWindow && mainWindow.show() && mainWindow.focus() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ]);
    tray.setContextMenu(ctxMenu);
    updateTrayState();
  } catch (e) { tray = null; /* 托盘创建失败不阻塞主流程 */ }
}

function updateTrayState() {
  if (!tray) return;
  const img = running
    ? nativeImage.createFromPath(path.join(__dirname, 'tray-running.png'))
    : nativeImage.createFromPath(path.join(__dirname, 'tray-idle.png'));
  tray.setImage(img);
  tray.setToolTip(running ? '鼠标连点器 - 运行中' : '鼠标连点器 - 未运行');
}

function pushStatus() {
  const payload = { running, clickCount, runStartedAt, theme: cfg.theme, statusbarOpacity: cfg.statusbarOpacity };
  for (const w of [mainWindow, statusWindow]) {
    if (w && !w.isDestroyed()) {
      w.webContents.send('status', payload);
    }
  }
}

function clickLoop() {
  if (!running) return;
  if (cfg.simType === 'keyboard') {
    // 键盘模式：连按字母 f（单击模式 down + up）
    sendKey(VK_F);
  } else {
    const fixed = cfg.mode === 'fixed';
    doClick(
      fixed ? Math.round(cfg.pos_x) : null,
      fixed ? Math.round(cfg.pos_y) : null,
      cfg.button,
      !!cfg.double
    );
  }
  clickCount += 1;
  if (!running) return;
  // 基于绝对时间戳补偿：无论本次点击/调度耗时多少，下一次都落在 nextTickAt 上
  const interval = Math.max(Number(cfg.interval_ms) || 10, 10);
  nextTickAt += interval;
  const delay = nextTickAt - Date.now();
  timer = setTimeout(clickLoop, Math.max(delay, 0));
}

function startClicking() {
  if (running) return;
  const ms = Number(cfg.interval_ms);
  if (!Number.isFinite(ms) || ms < 10) {
    cfg.interval_ms = 10;
  } else {
    cfg.interval_ms = Math.round(ms);
  }
  running = true;
  saveConfig();
  setTimerPrecision(true); // 连点开启：提升定时器分辨率保证点击间隔精度
  runStartedAt = Date.now();
  nextTickAt = Date.now(); // 立即点第一下
  if (!dragPaused) clickLoop(); // 拖动期间不启动循环，拖动结束（finishStatusDrag）后恢复
  pushStatus();
  applyStatusBarVisibility(); // 「停止时隐藏」开启时：启动即恢复显示
  updateTrayState();
  statusSound(true);
}

function stopClicking() {
  const wasRunning = running;
  running = false;
  runStartedAt = 0;
  if (timer) { clearTimeout(timer); timer = null; }
  if (wasRunning) setTimerPrecision(false); // 停止连点：恢复默认定时器分辨率，省系统 CPU
  saveConfig();
  pushStatus();
  applyStatusBarVisibility(); // 「停止时隐藏」开启时：停止即隐藏
  updateTrayState();
  if (wasRunning) statusSound(false); // 仅在确实由运行转停止时响提示音（退出兜底不响）
}

// ----------------------------------------------------------------------------
// 全局快捷键（支持自定义启动 / 暂停）
// ----------------------------------------------------------------------------
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const result = { start: true, stop: true, message: '' };
  if (cfg.startHotkey === cfg.stopHotkey) {
    // 启动/暂停为同一快捷键：切换模式（未运行→启动，运行中→停止）
    const toggle = () => (running ? stopClicking() : startClicking());
    const ok = globalShortcut.register(cfg.startHotkey, toggle);
    if (!ok) {
      result.start = false;
      result.stop = false;
      result.message = `快捷键 ${cfg.startHotkey} 注册失败（可能被其他程序占用）`;
    }
    return result;
  }
  if (!globalShortcut.register(cfg.startHotkey, startClicking)) {
    result.start = false;
    result.message += `启动快捷键 ${cfg.startHotkey} 注册失败（可能被其他程序占用）`;
  }
  if (!globalShortcut.register(cfg.stopHotkey, stopClicking)) {
    result.stop = false;
    result.message += `暂停快捷键 ${cfg.stopHotkey} 注册失败（可能被其他程序占用）`;
  }
  return result;
}

// ----------------------------------------------------------------------------
// IPC
// ----------------------------------------------------------------------------
ipcMain.handle('cfg:get', () => ({ ...cfg, running, clickCount, runStartedAt }));

ipcMain.handle('cfg:save', (_e, patch) => {
  Object.assign(cfg, patch || {});
  saveConfig();
  if ('showStatusbar' in (patch || {}) || 'hideStatusbarWhenStopped' in (patch || {})) applyStatusBarVisibility();
  if ('statusbarOpacity' in (patch || {})) pushStatus(); // 透明度变更：推送给状态栏实时生效
  return { ...cfg };
});

// 录制快捷键时挂起全部全局热键，避免旧键拦截按键导致录制失败
ipcMain.handle('hotkey:suspend', () => {
  globalShortcut.unregisterAll();
  return true;
});

// 录制结束（成功或取消）后恢复注册
ipcMain.handle('hotkey:resume', () => registerHotkeys());

ipcMain.handle('hotkey:set', (_e, { which, accelerator }) => {
  if (!accelerator) return { ok: false, message: '快捷键为空' };
  // 允许启动/暂停设为同一快捷键（切换模式），仅做注册有效性校验
  const key = which === 'start' ? 'startHotkey' : 'stopHotkey';
  const oldVal = cfg[key];
  cfg[key] = accelerator;
  const result = registerHotkeys();
  if (!result.start || !result.stop) {
    // 注册失败则回滚
    cfg[key] = oldVal;
    registerHotkeys();
    return { ok: false, message: result.message || '注册失败（可能被其他程序占用）' };
  }
  saveConfig();
  return { ok: true, startHotkey: cfg.startHotkey, stopHotkey: cfg.stopHotkey };
});

ipcMain.handle('click:start', startClicking);
ipcMain.handle('click:stop', stopClicking);
ipcMain.handle('cursor:pos', () => getCursorPos());

// 重置状态栏位置到默认（顶部中央）
ipcMain.handle('statusbar:reset-position', () => {
  cfg.statusbarPos = null;
  saveConfig();
  if (statusWindow && !statusWindow.isDestroyed()) {
    const wa = screen.getPrimaryDisplay().workArea;
    const [w] = statusWindow.getSize();
    const x = wa.x + Math.round((wa.width - w) / 2);
    const y = wa.y; // 紧贴顶部
    statusWindow.setBounds({ x, y, width: STATUS_BAR_W, height: STATUS_BAR_H });
  }
  return true;
});

// 重置为默认配置（含快捷键），并停止连点
ipcMain.handle('cfg:reset', () => {
  stopClicking();
  cfg = { ...DEFAULT_CFG };
  saveConfig();
  registerHotkeys();
  applyNativeTheme();
  applyStatusBarVisibility();
  return { ...cfg, running, clickCount };
});

// 让原生标题栏颜色跟随应用主题（覆盖系统深色模式）
function applyNativeTheme() {
  nativeTheme.themeSource = cfg.theme === 'light' ? 'light' : 'dark';
}

// 主题切换：同步原生标题栏颜色
ipcMain.handle('theme:set', (_e, t) => {
  cfg.theme = t === 'light' ? 'light' : 'dark';
  saveConfig();
  applyNativeTheme();
  pushStatus(); // 状态栏随主题换色
  return { theme: cfg.theme };
});

// ----------------------------------------------------------------------------
// 窗口
// ----------------------------------------------------------------------------
// 部分环境（虚拟机/远程桌面）GPU 进程会反复崩溃，禁用硬件加速与 GPU 沙箱保证稳定
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 760,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: '鼠标连点器',
    show: false, // 先隐藏，等首帧渲染完成再显示，避免启动白屏
    icon: path.join(__dirname, 'app.ico'),
    backgroundColor: cfg.theme === 'light' ? '#f4f7fb' : '#141414',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // 首帧渲染就绪后才显示窗口（Electron 官方防白屏做法）
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  // 兜底：若 ready-to-show 长时间未触发（异常场景），3 秒后强制显示避免窗口永不出现
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  }, 3000);
  // 开发模式走 Vite 开发服务器（HMR），生产模式加载 Vite 构建产物
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'));
  }
  mainWindow.on('show', () => pushStatus()); // 窗口显示时刷新状态，消除后台期间的视觉残余
  mainWindow.on('closed', () => {
    mainWindow = null;
    app.quit(); // 保持既有语义：关闭主窗口即退出（状态栏为附属窗口，一并退出）
  });
}

// ----------------------------------------------------------------------------
// 状态栏（置顶胶囊条：显示运行中/已停止，支持拖动，可隐藏）
// ----------------------------------------------------------------------------
// 固定尺寸：初始定位用 setBounds 锁死宽高，规避 Electron 在 Windows 非 100% 缩放下
// setPosition 导致窗口尺寸变化的已知 bug（electron#9477）；拖动改用 app-region: drag 系统原生实现
const STATUS_BAR_W = 92;
const STATUS_BAR_H = 30;

function applyStatusBarVisibility() {
  if (!statusWindow) return;
  // 总开关关闭，或「停止时隐藏」开启且未运行 → 隐藏
  const hidden = cfg.showStatusbar === false
    || (cfg.hideStatusbarWhenStopped === true && !running);
  // 不调用 hide/show（透明窗口 show 会闪一帧，setOpacity 与透明窗口冲突）：
  // 窗口常驻，隐藏 = 页面内藏起胶囊（透明窗口零像素不可见）+ 鼠标穿透
  statusWindow.webContents.send('bar-visibility', !hidden);
  statusWindow.setIgnoreMouseEvents(hidden, { forward: true });
}

function createStatusBar() {
  statusWindow = new BrowserWindow({
    width: STATUS_BAR_W,
    height: STATUS_BAR_H,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // 不抢焦点：app-region: drag 等同标题栏，Windows 按下即激活窗口切走前台；
                     // 配合下方 setAlwaysOnTop 双重置顶（focusable:false 需显式重设置顶）
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'statusbar-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // 置顶层级最高（覆盖无边框全屏/最大化窗口）
  statusWindow.setAlwaysOnTop(true, 'screen-saver');
  // 某些全屏/置顶应用会抢占层级，被拉下时自动纠偏回置顶
  statusWindow.on('always-on-top-changed', (_e, onTop) => {
    if (!onTop && statusWindow && !statusWindow.isDestroyed()) {
      statusWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });
  // 拖动：app-region: drag 走系统原生拖动（流畅、无 #9477 尺寸 bug），move 事件驱动暂停/恢复
  statusWindow.on('move', onStatusBarMove);
  // 初始位置：优先上次拖动记忆，否则主显示器工作区右上角
  const wa = screen.getPrimaryDisplay().workArea;
  const [w] = statusWindow.getSize();
  let x = wa.x + Math.round((wa.width - w) / 2); // 顶部水平居中
  let y = wa.y; // 紧贴顶部
  const p = cfg.statusbarPos;
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    x = Math.round(p.x);
    y = Math.round(p.y);
  }
  statusWindow.setBounds({ x, y, width: STATUS_BAR_W, height: STATUS_BAR_H });
  statusWindow.loadFile(path.join(__dirname, 'statusbar.html'));
  statusWindow.once('ready-to-show', () => {
    // focusable:false 在部分 Windows 版本上会丢置顶，ready 后重设置顶双保险
    statusWindow.setAlwaysOnTop(true, 'screen-saver');
    statusWindow.showInactive(); // 窗口常驻显示（隐藏由页面内藏胶囊实现）
    applyStatusBarVisibility(); // 初始鼠标穿透 + 可见性同步
    pushStatus(); // 页面就绪后同步状态与主题
  });
  statusWindow.on('closed', () => { statusWindow = null; });
}

// 拖动开始（move 首次触发）：临时暂停连点
function onStatusBarMove() {
  if (!statusDragging) {
    statusDragging = true;
    dragPaused = true;
    if (running && timer) { clearTimeout(timer); timer = null; }
  }
  if (statusDragEndTimer) clearTimeout(statusDragEndTimer);
  statusDragEndTimer = setTimeout(finishStatusDrag, 150);
}

// 拖动结束（move 停止 150ms）：记忆位置、恢复连点
function finishStatusDrag() {
  statusDragging = false;
  dragPaused = false;
  if (statusWindow && !statusWindow.isDestroyed()) {
    const [x, y] = statusWindow.getPosition();
    cfg.statusbarPos = { x, y };
    saveConfig();
  }
  if (running) {
    nextTickAt = Date.now();
    clickLoop();
  }
}

// 单实例锁：只允许一个实例运行，二次启动时聚焦已有窗口
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  // 移除默认应用菜单（File/Edit/View…），按 Alt 不再弹出编辑栏；
  // 无菜单时 Chromium 仍保留输入框内的复制/粘贴等编辑快捷键
  Menu.setApplicationMenu(null);
  loadConfig();
  applyNativeTheme();
  registerHotkeys();
  createWindow();
  createStatusBar();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  if (statusDragEndTimer) { clearTimeout(statusDragEndTimer); statusDragEndTimer = null; }
  stopClicking();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit();
});
