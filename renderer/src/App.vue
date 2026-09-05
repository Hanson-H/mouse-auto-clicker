<template>
  <n-config-provider :theme="theme === 'light' ? lightTheme : darkTheme" :locale="zhCN" :theme-overrides="themeOverrides">
    <div class="app">
      <!-- 顶栏 -->
      <header class="app-header">
        <div class="app-title">
          <svg class="app-icon" viewBox="0 0 256 256" aria-hidden="true"><path d="M88 24v-8a8 8 0 0 1 16 0v8a8 8 0 0 1-16 0m-72 80h8a8 8 0 0 0 0-16h-8a8 8 0 0 0 0 16m108.42-64.84a8 8 0 0 0 10.74-3.58l8-16a8 8 0 0 0-14.31-7.16l-8 16a8 8 0 0 0 3.57 10.74m-96 81.69l-16 8a8 8 0 0 0 7.16 14.31l16-8a8 8 0 1 0-7.16-14.31M219.31 184a16 16 0 0 1 0 22.63l-12.68 12.68a16 16 0 0 1-22.63 0L132.7 168L115 214.09c0 .1-.08.21-.13.32a15.83 15.83 0 0 1-14.6 9.59h-.79a15.83 15.83 0 0 1-14.41-11L32.8 52.92A16 16 0 0 1 52.92 32.8L213 85.07a16 16 0 0 1 1.41 29.8l-.32.13L168 132.69ZM208 195.31L156.69 144a16 16 0 0 1 4.93-26l.32-.14l45.95-17.64L48 48l52.2 159.86l17.65-46c0-.11.08-.22.13-.33a16 16 0 0 1 11.69-9.34a16.7 16.7 0 0 1 3-.28a16 16 0 0 1 11.3 4.69l51.34 51.4Z"/></svg>
          <span>鼠标连点器</span>
        </div>
        <div class="header-right">
          <div class="hotkey-badge">{{ hotkeyBadgeText }}</div>
          <button class="theme-toggle" :title="theme === 'light' ? '切换到暗色' : '切换到浅色'" @click="toggleTheme">
            <svg v-if="theme === 'light'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <circle cx="12" cy="12" r="4"/>
              <path d="M12 2v2"/><path d="M12 20v2"/>
              <path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/>
              <path d="M2 12h2"/><path d="M20 12h2"/>
              <path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
            </svg>
          </button>
        </div>
      </header>

      <!-- 状态卡（方案 B 整体居中，纯展示；启停由热键控制） -->
      <section class="glass-card status-card" :class="{ running }">
        <div class="st-ring"></div>
        <div class="st-text">{{ running ? '运行中' : '已停止' }}</div>
        <span class="st-sep">·</span>
        <div class="st-sub">{{ cfg.simType === 'keyboard' ? '键盘' : '鼠标' }} · 每 {{ cfg.interval_ms }}ms</div>
      </section>

      <!-- 点击间隔 -->
      <section class="glass-card">
        <div class="card-title">点击间隔</div>
        <div class="row">
          <n-input-number
            v-model:value="cfg.interval_ms"
            :min="10"
            :step="10"
            :update-value-on-input="false"
            style="width: 160px"
            @update:value="saveCfg"
          />
          <span class="unit">毫秒 (ms)</span>
        </div>
        <p class="hint">每次点击之间的等待时间，最小 10 ms</p>
      </section>

      <!-- 点击位置（键盘输入模式下整卡禁用） -->
      <section class="glass-card" :class="{ disabled: cfg.simType !== 'mouse' }">
        <div class="card-title">点击位置</div>
        <div class="seg" :class="{ dis: cfg.simType !== 'mouse', r2: cfg.mode === 'fixed' }" @click="onSeg('mode', $event)">
          <div class="thumb"></div>
          <span class="op" data-v="follow" :class="{ sel: cfg.mode === 'follow' }">跟随鼠标</span>
          <span class="op" data-v="fixed"  :class="{ sel: cfg.mode === 'fixed' }">固定位置</span>
        </div>
        <div class="row" style="margin-top: 12px" :class="{ disabled: cfg.mode !== 'fixed' }">
          <span class="label">X</span>
          <n-input-number v-model:value="cfg.pos_x" :min="0" size="small" style="width: 96px" :disabled="cfg.simType !== 'mouse' || cfg.mode !== 'fixed'" @update:value="saveCfg" />
          <span class="label">Y</span>
          <n-input-number v-model:value="cfg.pos_y" :min="0" size="small" style="width: 96px" :disabled="cfg.simType !== 'mouse' || cfg.mode !== 'fixed'" @update:value="saveCfg" />
        </div>
        <div class="row" :class="{ disabled: cfg.mode !== 'fixed' }">
          <n-button size="small" :disabled="cfg.simType !== 'mouse' || cfg.mode !== 'fixed' || pickCounting" @click="startPick">
            {{ pickBtnText }}
          </n-button>
        </div>
        <p v-if="cfg.simType !== 'mouse'" class="hint">键盘输入模式下整卡禁用，不可修改</p>
      </section>

      <!-- 点击方式 -->
      <section class="glass-card">
        <div class="card-title">点击方式</div>
        <div class="row spread">
          <span class="label">输入类型</span>
          <div class="seg" :class="{ r2: cfg.simType === 'keyboard' }" @click="onSeg('simType', $event)">
            <div class="thumb"></div>
            <span class="op" data-v="mouse"    :class="{ sel: cfg.simType === 'mouse' }">鼠标</span>
            <span class="op" data-v="keyboard" :class="{ sel: cfg.simType === 'keyboard' }">键盘</span>
          </div>
        </div>

        <!-- 鼠标分支 -->
        <template v-if="cfg.simType === 'mouse'">
          <div class="row spread">
            <span class="label">鼠标按键</span>
            <div class="seg" :class="{ r2: cfg.button === 'right' }" @click="onSeg('button', $event)">
              <div class="thumb"></div>
              <span class="op" data-v="left"  :class="{ sel: cfg.button === 'left' }">左键</span>
              <span class="op" data-v="right" :class="{ sel: cfg.button === 'right' }">右键</span>
            </div>
          </div>
          <div class="row spread">
            <span class="label">点击类型</span>
            <div class="seg" :class="{ r2: clickType === 'double' }" @click="onSeg('clickType', $event)">
              <div class="thumb"></div>
              <span class="op" data-v="single" :class="{ sel: clickType === 'single' }">单击</span>
              <span class="op" data-v="double" :class="{ sel: clickType === 'double' }">双击</span>
            </div>
          </div>
        </template>

        <!-- 键盘分支：固定显示 F -->
        <template v-else>
          <div class="row spread">
            <span class="label">按键</span>
            <span class="key-badge">F</span>
          </div>
          <p class="hint">点击位置 / 鼠标按键 / 点击类型不生效</p>
        </template>
      </section>

      <!-- 快捷键 -->
      <section class="glass-card">
        <div class="card-title">快捷键</div>
        <div class="row spread">
          <span class="label">启动连点</span>
          <button class="hotkey-btn" :class="{ capturing: capturing === 'start' }" @click="beginCapture('start')">
            {{ capturing === 'start' ? '按下按键…' : cfg.startHotkey }}
          </button>
        </div>
        <div class="row spread">
          <span class="label">暂停连点</span>
          <button class="hotkey-btn" :class="{ capturing: capturing === 'stop' }" @click="beginCapture('stop')">
            {{ capturing === 'stop' ? '按下按键…' : cfg.stopHotkey }}
          </button>
        </div>
        <p class="hint">{{ hotkeyTip }}</p>
      </section>

      <!-- 重置 -->
      <div class="reset-row">
        <n-button size="small" quaternary @click="resetAll">
          ↺ 重置为默认设置
        </n-button>
      </div>

      <footer class="footer">提示：1000ms 以下短间隔建议优先用「双击」配合较长间隔，或确认无游戏反作弊</footer>
    </div>
  </n-config-provider>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import {
  NConfigProvider,
  NInputNumber,
  NButton,
  darkTheme,
  lightTheme,
  zhCN,
} from 'naive-ui';

const bridge = window.api;

// ---------- 主题（科技感青蓝配色，随明暗主题切换） ----------
const theme = ref('dark');
const themeOverrides = computed(() => ({
  common: {
    primaryColor: theme.value === 'light' ? '#007aff' : '#0a84ff',
    primaryColorHover: theme.value === 'light' ? '#1a80ff' : '#409cff',
    primaryColorPressed: theme.value === 'light' ? '#0062cc' : '#0066d6',
    primaryColorSuppl: theme.value === 'light' ? '#007aff' : '#0a84ff',
    borderRadius: '9px',
    bodyColor: 'transparent',
    cardColor: 'transparent',
    inputColor: theme.value === 'light' ? '#f2f2f7' : '#2c2c2e',
    inputColorDisabled: theme.value === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)',
    actionColor: theme.value === 'light' ? '#f2f2f7' : '#2c2c2e',
    buttonColor2: theme.value === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
    textColorBase: theme.value === 'light' ? '#000000' : '#ffffff',
    textColor1: theme.value === 'light' ? '#000000' : '#ffffff',
    textColor2: theme.value === 'light' ? 'rgba(60,60,67,0.75)' : 'rgba(235,235,245,0.85)',
    textColor3: theme.value === 'light' ? 'rgba(60,60,67,0.5)' : 'rgba(235,235,245,0.45)',
  },
}));

function applyTheme(t) {
  theme.value = t;
  // 设置在 <html> 上（而非 body），确保滚动条等根级伪元素也能继承主题变量
  document.documentElement.setAttribute('data-theme', t);
}

function toggleTheme() {
  const next = theme.value === 'light' ? 'dark' : 'light';
  applyTheme(next);
  bridge.setTheme(next); // 同步原生标题栏颜色
}

// ---------- 状态 ----------
const cfg = reactive({
  interval_ms: 100,
  simType: 'mouse',
  mode: 'follow',
  pos_x: 500,
  pos_y: 400,
  button: 'left',
  double: false,
  startHotkey: 'F6',
  stopHotkey: 'F7',
});
const running = ref(false);
const clickCount = ref(0);
const runMs = ref(0); // 运行时长（ms）：运行中实时累计，停止后定格为上次时长
let runStartedAt = 0;
let runTimer = null;
const pickCounting = ref(false);
const pickBtnText = ref('⏱ 3 秒后拾取');
const capturing = ref(null); // 'start' | 'stop' | null
const hotkeyTip = ref('点击右侧按键后，直接按下新快捷键即可更换；两个键设为相同时按一下启动、再按停止');

function fmtDur(ms) {
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// 自定义 Segmented 控件：点击 .op 切换 cfg 字段，滑块由 .seg .r2 CSS 自动平移
function onSeg(field, e) {
  const t = e.target.closest('.op');
  if (!t) return;
  const v = t.getAttribute('data-v');
  if (field === 'simType') cfg.simType = v;
  else if (field === 'mode') cfg.mode = v;
  else if (field === 'button') cfg.button = v;
  else if (field === 'clickType') cfg.double = v === 'double';
  saveCfg();
}

function tickRunMs() {
  if (runStartedAt) runMs.value = Date.now() - runStartedAt;
}

function applyRunState(isRunning, startedAt) {
  if (isRunning) {
    runStartedAt = startedAt || Date.now();
    if (!runTimer) runTimer = setInterval(tickRunMs, 1000);
    tickRunMs();
  } else {
    if (runTimer) { clearInterval(runTimer); runTimer = null; }
    runStartedAt = 0; // runMs 保留定格为上次时长
  }
}

const clickType = computed({
  get: () => (cfg.double ? 'double' : 'single'),
  set: (v) => { cfg.double = v === 'double'; },
});

const hotkeyBadgeText = computed(() =>
  cfg.startHotkey === cfg.stopHotkey
    ? `${cfg.startHotkey} 启动/暂停`
    : `${cfg.startHotkey} 启动 / ${cfg.stopHotkey} 暂停`
);

// ---------- IPC ----------
function saveCfg() {
  bridge.saveConfig({
    interval_ms: cfg.interval_ms,
    simType: cfg.simType,
    mode: cfg.mode,
    pos_x: cfg.pos_x,
    pos_y: cfg.pos_y,
    button: cfg.button,
    double: cfg.double,
  });
}

function toggleClick() {
  if (running.value) bridge.stopClick();
  else bridge.startClick();
}

async function resetAll() {
  const c = await bridge.resetConfig();
  Object.assign(cfg, {
    interval_ms: c.interval_ms,
    simType: c.simType || 'mouse',
    mode: c.mode,
    pos_x: c.pos_x,
    pos_y: c.pos_y,
    button: c.button,
    double: !!c.double,
    startHotkey: c.startHotkey,
    stopHotkey: c.stopHotkey,
  });
  running.value = !!c.running;
  clickCount.value = c.clickCount || 0;
  applyTheme(c.theme === 'light' ? 'light' : 'dark');
  hotkeyTip.value = '已重置为默认设置（间隔 100ms、输入类型 鼠标、跟随鼠标、左键单击、F6/F7）';
}

// ---------- 坐标拾取 ----------
function startPick() {
  if (pickCounting.value) return;
  pickCounting.value = true;
  let n = 3;
  const tick = async () => {
    if (n > 0) {
      pickBtnText.value = `移到目标处… ${n}`;
      n -= 1;
      setTimeout(tick, 1000);
    } else {
      const pos = await bridge.getCursorPos();
      cfg.pos_x = pos.x;
      cfg.pos_y = pos.y;
      saveCfg();
      pickBtnText.value = '⏱ 3 秒后拾取';
      pickCounting.value = false;
    }
  };
  tick();
}

// ---------- 快捷键录制 ----------
function eventToAccelerator(e) {
  const code = e.code || '';
  let key = null;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  if (!key) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

function beginCapture(which) {
  if (capturing.value) return;
  capturing.value = which;
  // 挂起全部全局热键，避免旧键在系统层拦截按键导致录制失败
  bridge.suspendHotkeys();
  hotkeyTip.value = '按下新快捷键（支持 Ctrl / Alt / Shift + 字母/数字/F1-F24），按 Esc 取消';
}

async function finishCapture(accelerator) {
  const which = capturing.value;
  const res = await bridge.setHotkey(which, accelerator);
  if (res.ok) {
    cfg.startHotkey = res.startHotkey;
    cfg.stopHotkey = res.stopHotkey;
    hotkeyTip.value = cfg.startHotkey === cfg.stopHotkey
      ? `✓ ${accelerator} 已生效（同一键切换：按下启动，再按停止）`
      : `✓ ${accelerator} 已生效（点击右侧按键可再次更换）`;
  } else {
    hotkeyTip.value = `✗ ${accelerator}：${res.message}`;
  }
  capturing.value = null;
}

function onGlobalKeydown(e) {
  if (!capturing.value) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape') {
    capturing.value = null;
    bridge.resumeHotkeys(); // 取消录制，恢复原热键
    hotkeyTip.value = '点击右侧按键后，直接按下新快捷键即可更换；两个键设为相同时按一下启动、再按停止';
    return;
  }
  const accel = eventToAccelerator(e);
  if (accel) finishCapture(accel);
}

// ---------- 生命周期 ----------
onMounted(async () => {
  const c = await bridge.getConfig();
  Object.assign(cfg, {
    interval_ms: c.interval_ms,
    simType: c.simType || 'mouse', // 兼容旧 config.json（无此字段时回落鼠标模式）
    mode: c.mode,
    pos_x: c.pos_x,
    pos_y: c.pos_y,
    button: c.button,
    double: !!c.double,
    startHotkey: c.startHotkey,
    stopHotkey: c.stopHotkey,
  });
  applyTheme(c.theme === 'light' ? 'light' : 'dark');
  running.value = !!c.running;
  clickCount.value = c.clickCount || 0;
  applyRunState(!!c.running, c.runStartedAt);

  window.addEventListener('keydown', onGlobalKeydown);
  bridge.onStatus((s) => {
    running.value = s.running;
    clickCount.value = s.clickCount;
    applyRunState(!!s.running, s.runStartedAt);
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  if (runTimer) { clearInterval(runTimer); runTimer = null; }
});
</script>

<style scoped>
.app {
  max-width: 460px;
  margin: 0 auto;
  padding: 4px 16px 20px;
}
</style>
