// -*- coding: utf-8 -*-
// 鼠标连点器 - Electron 版 主进程
// 功能：Win32 SendInput 模拟点击、自定义启动/暂停全局快捷键、配置持久化
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
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
const GetCursorPos = user32.func('int GetCursorPos(_Out_ POINT *lpPoint)');
const SetCursorPos = user32.func('int SetCursorPos(int X, int Y)');

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
  if (running) {
    timer = setTimeout(clickLoop, Math.max(cfg.interval_ms, 10));
  }
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
    try {
      const toggle = () => (running ? stopClicking() : startClicking());
      globalShortcut.register(cfg.startHotkey, toggle);
    } catch (e) {
      result.start = false;
      result.stop = false;
      result.message = `快捷键 ${cfg.startHotkey} 注册失败 `;
    }
    return result;
  }
  try {
    globalShortcut.register(cfg.startHotkey, startClicking);
  } catch (e) {
    result.start = false;
    result.message += `启动快捷键 ${cfg.startHotkey} 注册失败 `;
  }
  try {
    globalShortcut.register(cfg.stopHotkey, stopClicking);
  } catch (e) {
    result.stop = false;
    result.message += `暂停快捷键 ${cfg.stopHotkey} 注册失败`;
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
    backgroundColor: '#14161b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  loadConfig();
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
