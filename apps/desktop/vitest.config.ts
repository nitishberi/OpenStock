import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@desktop': path.resolve(__dirname, 'src'),
      '@': path.resolve(__dirname, '../..'),
    },
  },
});
