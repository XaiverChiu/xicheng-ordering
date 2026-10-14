import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // 新前端由 Fastify 以 /new 预览路径托管
  base: '/new/',
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5200,
    // 开发期把 /api 代理到现有 Fastify 后端（4500 或 4599）
    proxy: {
      '/api': {
        target: process.env.XC_API || 'http://127.0.0.1:4500',
        changeOrigin: true,
      },
      '/uploads': {
        target: process.env.XC_API || 'http://127.0.0.1:4500',
        changeOrigin: true,
      },
      '/pay-wechat.png': {
        target: process.env.XC_API || 'http://127.0.0.1:4500',
        changeOrigin: true,
      },
      '/pay-alipay.png': {
        target: process.env.XC_API || 'http://127.0.0.1:4500',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
  preview: {
    port: 5200,
    proxy: {
      '/api': { target: process.env.XC_API || 'http://127.0.0.1:4500', changeOrigin: true },
      '/uploads': { target: process.env.XC_API || 'http://127.0.0.1:4500', changeOrigin: true },
      '/pay-wechat.png': { target: process.env.XC_API || 'http://127.0.0.1:4500', changeOrigin: true },
      '/pay-alipay.png': { target: process.env.XC_API || 'http://127.0.0.1:4500', changeOrigin: true },
    },
  },
});
