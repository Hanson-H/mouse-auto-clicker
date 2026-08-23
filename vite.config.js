import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 渲染层根目录为 renderer/，构建产物输出到 renderer/dist
export default defineConfig({
  root: 'renderer',
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: false,
  },
});
