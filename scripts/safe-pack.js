// 安全打包脚本：先检测 win-unpacked 是否被运行中的应用锁定，再执行构建打包。
// 用法：npm run dist:safe
// 背景：运行中的「鼠标连点器」会锁住 dist/win-unpacked，electron-builder 清空
// 目录时 Access denied 静默退出（无输出），白白等待数分钟。本脚本提前探测并明确报错。
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const unpackedExe = path.join(root, 'dist', 'win-unpacked', '鼠标连点器.exe');

// 1. 锁检测：运行中的 exe 无法以写模式打开（image section 共享冲突）
if (fs.existsSync(unpackedExe)) {
  try {
    const fd = fs.openSync(unpackedExe, 'r+');
    fs.closeSync(fd);
  } catch (e) {
    console.error('\n[x] 检测到「鼠标连点器」正在运行，dist/win-unpacked 被锁定。');
    console.error('    请先关闭应用（含托盘/后台实例），再重新执行 npm run dist:safe');
    process.exit(1);
  }
}

// 2. 清理 IDE 注入的干扰变量
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;

// 3. 构建渲染层
console.log('[1/2] vite build ...');
execSync('vite build', { stdio: 'inherit', env, shell: true, cwd: root });

// 4. electron-builder 打包（packaging 阶段偶发 Access denied 静默退出 → 自动重试一次）
function runBuilder(attempt) {
  try {
    execSync('npx electron-builder', { stdio: 'inherit', env, shell: true, cwd: root });
    return true;
  } catch (e) {
    if (attempt < 2) {
      console.log(`\n[!] electron-builder 第 ${attempt} 次异常退出（多因杀软/索引服务瞬时锁），3 秒后自动重试...`);
      execSync('powershell -NoProfile -Command "Start-Sleep -Seconds 3"', { stdio: 'ignore' });
      return runBuilder(attempt + 1);
    }
    return false;
  }
}
console.log('[2/2] electron-builder ...');
if (!runBuilder(1)) {
  console.error('\n[x] electron-builder 连续失败，请检查上方日志（若提示 Access denied，多为杀软扫描，稍后重试）');
  process.exit(1);
}

// 5. 验证产物
const setupDir = path.join(root, 'dist');
const setup = fs.readdirSync(setupDir).find((f) => /^鼠标连点器 Setup .+\.exe$/.test(f));
if (setup) {
  const stat = fs.statSync(path.join(setupDir, setup));
  console.log(`\n[ok] ${setup}（${(stat.size / 1024 / 1024).toFixed(1)} MB，${stat.mtime.toLocaleString('zh-CN')}）`);
} else {
  console.error('\n[x] 未找到 Setup 产物，打包可能异常，请检查上方日志');
  process.exit(1);
}
