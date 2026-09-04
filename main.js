// -*- coding: utf-8 -*-
// 鼠标连点器 - Electron 版 主进程
// 功能：Win32 SendInput 模拟点击、自定义启动/暂停全局快捷键、配置持久化
const { app, BrowserWindow, globalShortcut, ipcMain, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
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
const GetCursorPos = user32.func('int GetCursorPos(_Out_ POINT *lpPoint)');
const SetCursorPos = user32.func('int SetCursorPos(int X, int Y)');

// 提升 Windows 定时器分辨率到 1ms，消除 setTimeout 在短间隔下的量化误差
try {
  const winmm = koffi.load('winmm.dll');
  const timeBeginPeriod = winmm.func('uint32 timeBeginPeriod(uint32 uPeriod)');
  timeBeginPeriod(1);
} catch (e) { /* 忽略：非关键，不影响主流程 */ }

const INPUT_MOUSE = 0;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;

function sendMouse(flags) {
  SendInput(1, { type: INPUT_MOUSE, dwFlags: flags }, koffi.sizeof(INPUT));
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
// 管理员权限检测 + 提权重启（解决 UIPI：低权限进程无法向管理员窗口发送输入）
// ----------------------------------------------------------------------------
// `net session` 是 Windows 内置命令：普通用户返回非 0 退出码，管理员返回 0
function isAdmin() {
  if (process.platform !== 'win32') return false;
  try {
    const r = spawnSync('net', ['session'], { stdio: 'ignore' });
    return r.status === 0;
  } catch (e) {
    return false;
  }
}

// 以管理员身份重启当前应用（触发 UAC 弹窗）
function relaunchAsAdmin() {
  if (process.platform !== 'win32') return;
  const exe = process.execPath;
  // 把参数数组拼接成 PowerShell 单引号字符串安全的格式
  const args = process.argv.slice(1).map((a) => `'${String(a).replace(/'/g, `''`)}'`).join(',');
  // Start-Process -Verb RunAs 触发 UAC；powershell 进程本身不需要管理员
  const psCmd = `Start-Process -FilePath "${exe}" -ArgumentList ${args} -Verb RunAs`;
  spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { stdio: 'ignore' });
  app.quit();
}

// 在桌面创建"以管理员身份运行"的快捷方式（双击该快捷方式会自动 UAC 启动）
function createAdminShortcut(target) {
  if (process.platform !== 'win32') return { ok: false, message: '仅 Windows 支持' };
  const exe = process.execPath;
  // 转义 PowerShell 单引号字符串内的单引号
  const esc = (s) => String(s).replace(/'/g, `''`);
  const lnkEsc = esc(target.lnkPath);
  const exeEsc = esc(exe);
  const dirEsc = esc(path.dirname(exe));

  // PowerShell 脚本：用 WScript.Shell 创建 .lnk，再修改二进制 LinkFlags 添加 0x2000 (RunAsAdmin)
  // 这是 Set-RunAsAdmin (PSGallery) 的标准做法，对 Win10/11 有效
  const psCmd = `
$ErrorActionPreference = 'Stop'
$lnkPath = '${lnkEsc}'
$exePath = '${exeEsc}'
$workDir = '${dirEsc}'

if (Test-Path $lnkPath) { Remove-Item $lnkPath -Force }
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = $exePath
$lnk.WorkingDirectory = $workDir
$lnk.IconLocation = "$exePath,0"
$lnk.Description = 'Mouse Auto Clicker (Run as Administrator)'
$lnk.Save()

# 修改 LinkFlags (offset 0x4C) 添加 SLDF_RUNAS_USER (0x2000)
$bytes = [System.IO.File]::ReadAllBytes($lnkPath)
$oldFlags = [BitConverter]::ToUInt32($bytes, 0x4C)
$newFlags = $oldFlags -bor 0x2000
[Array]::Copy([BitConverter]::GetBytes($newFlags), 0, $bytes, 0x4C, 4)
[System.IO.File]::WriteAllBytes($lnkPath, $bytes)
Write-Output 'OK'
`;

  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { encoding: 'utf-8' });
  if (r.status === 0) {
    return { ok: true, lnkPath: target.lnkPath };
  }
  return { ok: false, message: (r.stderr || r.stdout || '未知错误').trim().split('\n').slice(-3).join('\n') };
}

// ----------------------------------------------------------------------------
// 配置持久化
// ----------------------------------------------------------------------------
const DEFAULT_CFG = {
  interval_ms: 100,
  mode: 'follow',        // follow / fixed
  pos_x: 500,
  pos_y: 400,
  button: 'left',        // left / right
  double: false,
  startHotkey: 'F6',     // 启动连点快捷键
  stopHotkey: 'F7',      // 暂停连点快捷键
  theme: 'dark',         // dark / light
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
let nextTickAt = 0; // 下一次点击的绝对时间戳（ms），用于消除 setTimeout 累积漂移

function pushStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status', { running, clickCount });
  }
}

function clickLoop() {
  if (!running) return;
  const fixed = cfg.mode === 'fixed';
  doClick(
    fixed ? Math.round(cfg.pos_x) : null,
    fixed ? Math.round(cfg.pos_y) : null,
    cfg.button,
    !!cfg.double
  );
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
  nextTickAt = Date.now(); // 立即点第一下
  clickLoop();
  pushStatus();
}

function stopClicking() {
  running = false;
  if (timer) { clearTimeout(timer); timer = null; }
  saveConfig();
  pushStatus();
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
ipcMain.handle('cfg:get', () => ({ ...cfg, running, clickCount }));

ipcMain.handle('cfg:save', (_e, patch) => {
  Object.assign(cfg, patch || {});
  saveConfig();
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

// 以管理员身份重启（触发 UAC）；返回 true 表示已发出重启指令
ipcMain.handle('admin:relaunch', () => { relaunchAsAdmin(); return true; });

// 创建桌面"以管理员身份启动"快捷方式（位置：桌面 / 开始菜单）
ipcMain.handle('shortcut:createAdmin', (_e, payload) => {
  const location = (payload && payload.location) || 'desktop'; // desktop | startmenu
  const name = (payload && payload.name) || '鼠标连点器(管理员)';
  const baseDir = location === 'startmenu'
    ? path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    : app.getPath('desktop');
  const lnkPath = path.join(baseDir, `${name}.lnk`);
  return createAdminShortcut({ lnkPath });
});

// 重置为默认配置（含快捷键），并停止连点
ipcMain.handle('cfg:reset', () => {
  stopClicking();
  cfg = { ...DEFAULT_CFG };
  saveConfig();
  registerHotkeys();
  applyNativeTheme();
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
    icon: path.join(__dirname, 'app.ico'),
    backgroundColor: cfg.theme === 'light' ? '#f4f7fb' : '#14161b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // 开发模式走 Vite 开发服务器（HMR），生产模式加载 Vite 构建产物
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'dist', 'index.html'));
  }
  mainWindow.on('closed', () => { mainWindow = null; });
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
  loadConfig();
  applyNativeTheme();
  registerHotkeys();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  stopClicking();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit();
});
