// 鼠标连点器 - 渲染进程逻辑
const bridge = window.api;

const $ = (id) => document.getElementById(id);
const els = {
  hotkeyBadge: $('hotkeyBadge'),
  statusCard: document.querySelector('.status-card'),
  statusText: $('statusText'),
  statusCount: $('statusCount'),
  toggleBtn: $('toggleBtn'),
  intervalInput: $('intervalInput'),
  modeSeg: $('modeSeg'),
  fixedRow: $('fixedRow'),
  posX: $('posX'),
  posY: $('posY'),
  pickBtn: $('pickBtn'),
  buttonSeg: $('buttonSeg'),
  typeSeg: $('typeSeg'),
  startHotkeyBtn: $('startHotkeyBtn'),
  stopHotkeyBtn: $('stopHotkeyBtn'),
  hotkeyTip: $('hotkeyTip'),
};

let cfg = null;
let running = false;
let pickCounting = false;
let capturingHotkey = null; // 'start' | 'stop' | null

// ---------------- 初始化 ----------------
async function init() {
  cfg = await bridge.getConfig();
  running = !!cfg.running;

  els.intervalInput.value = cfg.interval_ms;
  els.posX.value = cfg.pos_x;
  els.posY.value = cfg.pos_y;

  setSegment(els.modeSeg, cfg.mode);
  setSegment(els.buttonSeg, cfg.button);
  setSegment(els.typeSeg, cfg.double ? 'double' : 'single');
  applyModeState();

  els.startHotkeyBtn.textContent = cfg.startHotkey;
  els.stopHotkeyBtn.textContent = cfg.stopHotkey;
  updateBadge();

  renderStatus();

  // 交互事件
  bindSegment(els.modeSeg, (v) => { cfg.mode = v; applyModeState(); saveCfg(); });
  bindSegment(els.buttonSeg, (v) => { cfg.button = v; saveCfg(); });
  bindSegment(els.typeSeg, (v) => { cfg.double = v === 'double'; saveCfg(); });

  els.pickBtn.addEventListener('click', startPick);
  els.toggleBtn.addEventListener('click', () => (running ? bridge.stopClick() : bridge.startClick()));

  els.startHotkeyBtn.addEventListener('click', () => beginCapture('start'));
  els.stopHotkeyBtn.addEventListener('click', () => beginCapture('stop'));

  window.addEventListener('keydown', onGlobalKeydown);

  els.intervalInput.addEventListener('change', () => {
    let ms = parseFloat(els.intervalInput.value);
    if (!Number.isFinite(ms) || ms < 10) ms = 10;
    els.intervalInput.value = Math.round(ms);
    cfg.interval_ms = Math.round(ms);
    saveCfg();
  });

  els.posX.addEventListener('change', () => { cfg.pos_x = parseInt(els.posX.value, 10) || 0; saveCfg(); });
  els.posY.addEventListener('change', () => { cfg.pos_y = parseInt(els.posY.value, 10) || 0; saveCfg(); });

  bridge.onStatus((s) => { running = s.running; renderStatus(s.clickCount); });
}

function saveCfg() {
  bridge.saveConfig({
    interval_ms: cfg.interval_ms,
    mode: cfg.mode,
    pos_x: cfg.pos_x,
    pos_y: cfg.pos_y,
    button: cfg.button,
    double: cfg.double,
  });
}

// ---------------- 分段按钮 ----------------
function setSegment(seg, value) {
  seg.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.value === value);
  });
}

function bindSegment(seg, cb) {
  seg.querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      setSegment(seg, b.dataset.value);
      cb(b.dataset.value);
    });
  });
}

function applyModeState() {
  els.fixedRow.classList.toggle('disabled', cfg.mode !== 'fixed');
  els.posX.disabled = els.posY.disabled = cfg.mode !== 'fixed';
}

// ---------------- 坐标拾取 ----------------
async function startPick() {
  if (pickCounting) return;
  pickCounting = true;
  let n = 3;
  const tick = async () => {
    if (n > 0) {
      els.pickBtn.textContent = `移到目标处… ${n}`;
      n -= 1;
      setTimeout(tick, 1000);
    } else {
      const pos = await bridge.getCursorPos();
      els.posX.value = pos.x;
      els.posY.value = pos.y;
      cfg.pos_x = pos.x;
      cfg.pos_y = pos.y;
      saveCfg();
      els.pickBtn.textContent = '⏱ 3 秒后拾取';
      pickCounting = false;
    }
  };
  tick();
}

// ---------------- 快捷键录制（新功能） ----------------
// 将 KeyboardEvent 转成 Electron accelerator 字符串，如 "Ctrl+Alt+P"、"F8"
function eventToAccelerator(e) {
  const code = e.code || '';
  let key = null;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;            // F1-F24
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3);            // 字母
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);          // 数字
  if (!key) return null; // 纯修饰键或其他键，继续等待
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

function beginCapture(which) {
  if (capturingHotkey) return;
  capturingHotkey = which;
  const btn = which === 'start' ? els.startHotkeyBtn : els.stopHotkeyBtn;
  btn.classList.add('capturing');
  btn.dataset.old = btn.textContent;
  btn.textContent = '按下按键…';
  els.hotkeyTip.textContent = '按下新快捷键（支持 Ctrl / Alt / Shift + 字母/数字/F1-F24），按 Esc 取消';
}

async function finishCapture(accelerator) {
  const which = capturingHotkey;
  const btn = which === 'start' ? els.startHotkeyBtn : els.stopHotkeyBtn;
  const res = await bridge.setHotkey(which, accelerator);
  if (res.ok) {
    if (which === 'start') cfg.startHotkey = res.startHotkey;
    else cfg.stopHotkey = res.stopHotkey;
    btn.textContent = accelerator;
    const same = cfg.startHotkey === cfg.stopHotkey;
    els.hotkeyTip.textContent = same
      ? `✓ ${accelerator} 已生效（同一键切换：按下启动，再按停止）`
      : `✓ ${accelerator} 已生效（点击右侧按键可再次更换）`;
  } else {
    btn.textContent = btn.dataset.old;
    els.hotkeyTip.textContent = `✗ ${accelerator}：${res.message}`;
  }
  btn.classList.remove('capturing');
  capturingHotkey = null;
  updateBadge();
}

function cancelCapture() {
  const btn = capturingHotkey === 'start' ? els.startHotkeyBtn : els.stopHotkeyBtn;
  btn.textContent = btn.dataset.old;
  btn.classList.remove('capturing');
  capturingHotkey = null;
  els.hotkeyTip.textContent = '点击右侧按键后，直接按下新快捷键即可更换（支持 Ctrl / Alt / Shift 组合）';
}

function onGlobalKeydown(e) {
  if (!capturingHotkey) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') { cancelCapture(); return; }
  const accel = eventToAccelerator(e);
  if (accel) finishCapture(accel);
}

function updateBadge() {
  if (!cfg) return;
  els.hotkeyBadge.textContent = cfg.startHotkey === cfg.stopHotkey
    ? `${cfg.startHotkey} 启动/暂停`
    : `${cfg.startHotkey} 启动 / ${cfg.stopHotkey} 暂停`;
}

// ---------------- 状态渲染 ----------------
function renderStatus(count) {
  els.statusCard.classList.toggle('running', running);
  els.statusText.textContent = running ? '运行中' : '已停止';
  els.toggleBtn.textContent = running ? '停止连点' : '开始连点';
  els.toggleBtn.classList.toggle('running', running);
  if (typeof count === 'number') {
    els.statusCount.textContent = `累计点击 ${count} 次`;
  }
}

init();
