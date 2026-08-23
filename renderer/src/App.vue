<template>
  <n-config-provider :theme="theme === 'light' ? lightTheme : darkTheme" :locale="zhCN" :theme-overrides="themeOverrides">
    <div class="app">
      <!-- 顶栏 -->
      <header class="app-header">
        <div class="app-title">🖱 鼠标连点器</div>
        <div class="header-right">
          <div class="hotkey-badge">{{ hotkeyBadgeText }}</div>
          <button class="theme-toggle" :title="theme === 'light' ? '切换到暗色' : '切换到浅色'" @click="toggleTheme">
            {{ theme === 'light' ? '☀' : '☾' }}
          </button>
        </div>
      </header>

      <!-- 状态卡 -->
      <section class="glass-card status-card" :class="{ running }">
        <div class="status-ring"><div class="status-dot"></div></div>
        <div class="status-text">{{ running ? '运行中' : '已停止' }}</div>
        <div class="status-count">累计点击 {{ clickCount }} 次</div>
        <button class="toggle-btn" :class="{ running }" @click="toggleClick">
          {{ running ? '停止连点' : '开始连点' }}
        </button>
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

      <!-- 点击位置 -->
      <section class="glass-card">
        <div class="card-title">点击位置</div>
        <n-radio-group v-model:value="cfg.mode" @update:value="saveCfg">
          <n-radio-button value="follow">跟随鼠标</n-radio-button>
          <n-radio-button value="fixed">固定位置</n-radio-button>
        </n-radio-group>
        <div class="row" style="margin-top: 12px" :class="{ disabled: cfg.mode !== 'fixed' }">
          <span class="label">X</span>
          <n-input-number v-model:value="cfg.pos_x" :min="0" size="small" style="width: 96px" :disabled="cfg.mode !== 'fixed'" @update:value="saveCfg" />
          <span class="label">Y</span>
          <n-input-number v-model:value="cfg.pos_y" :min="0" size="small" style="width: 96px" :disabled="cfg.mode !== 'fixed'" @update:value="saveCfg" />
        </div>
        <div class="row" :class="{ disabled: cfg.mode !== 'fixed' }">
          <n-button size="small" :disabled="cfg.mode !== 'fixed' || pickCounting" @click="startPick">
            {{ pickBtnText }}
          </n-button>
        </div>
      </section>

      <!-- 点击方式 -->
      <section class="glass-card">
        <div class="card-title">点击方式</div>
        <div class="row spread">
          <span class="label">鼠标按键</span>
          <n-radio-group v-model:value="cfg.button" size="small" @update:value="saveCfg">
            <n-radio-button value="left">左键</n-radio-button>
            <n-radio-button value="right">右键</n-radio-button>
          </n-radio-group>
        </div>
        <div class="row spread">
          <span class="label">点击类型</span>
          <n-radio-group v-model:value="clickType" size="small" @update:value="saveCfg">
            <n-radio-button value="single">单击</n-radio-button>
            <n-radio-button value="double">双击</n-radio-button>
          </n-radio-group>
        </div>
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

      <footer class="footer">提示：若目标程序以管理员身份运行，连点器也需管理员身份运行</footer>
    </div>
  </n-config-provider>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import {
  NConfigProvider,
  NInputNumber,
  NRadioGroup,
  NRadioButton,
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
    primaryColor: theme.value === 'light' ? '#0891b2' : '#22d3ee',
    primaryColorHover: theme.value === 'light' ? '#06b6d4' : '#67e8f9',
    primaryColorPressed: theme.value === 'light' ? '#0e7490' : '#06b6d4',
    primaryColorSuppl: theme.value === 'light' ? '#0891b2' : '#22d3ee',
    borderRadius: '10px',
    bodyColor: 'transparent',
    cardColor: 'transparent',
    inputColor: theme.value === 'light' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.05)',
    inputColorDisabled: theme.value === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.02)',
    actionColor: theme.value === 'light' ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.05)',
    buttonColor2: theme.value === 'light' ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)',
    textColorBase: theme.value === 'light' ? '#1e293b' : '#dbe4f0',
    textColor1: theme.value === 'light' ? '#0f172a' : '#e2e8f0',
    textColor2: theme.value === 'light' ? '#334155' : '#9fb2cc',
    textColor3: theme.value === 'light' ? '#64748b' : '#5b6b82',
  },
}));

function applyTheme(t) {
  theme.value = t;
  document.body.setAttribute('data-theme', t);
}

function toggleTheme() {
  const next = theme.value === 'light' ? 'dark' : 'light';
  applyTheme(next);
  bridge.saveConfig({ theme: next });
}

// ---------- 状态 ----------
const cfg = reactive({
  interval_ms: 100,
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
const pickCounting = ref(false);
const pickBtnText = ref('⏱ 3 秒后拾取');
const capturing = ref(null); // 'start' | 'stop' | null
const hotkeyTip = ref('点击右侧按键后，直接按下新快捷键即可更换；两个键设为相同时按一下启动、再按停止');

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
  hotkeyTip.value = '已重置为默认设置（间隔 100ms、跟随鼠标、左键单击、F6/F7）';
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

  window.addEventListener('keydown', onGlobalKeydown);
  bridge.onStatus((s) => {
    running.value = s.running;
    clickCount.value = s.clickCount;
  });
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
});
</script>

<style scoped>
.app {
  max-width: 460px;
  margin: 0 auto;
  padding: 4px 16px 20px;
}
</style>
