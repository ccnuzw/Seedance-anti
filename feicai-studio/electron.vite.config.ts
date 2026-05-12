import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const devConnectSrc =
  "connect-src 'self' https: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*;"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        external: ['better-sqlite3']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer')
      }
    },
    server: {
      headers: {
        'Content-Security-Policy': [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: file:",
          "font-src 'self' data:",
          devConnectSrc
        ].join('; ')
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('@xyflow/react')) {
              return 'xyflow'
            }
            if (
              id.includes('/src/renderer/components/layout/AppShell.tsx') ||
              id.includes('/src/renderer/components/layout/Sidebar.tsx') ||
              id.includes('/src/renderer/components/layout/Header.tsx') ||
              id.includes('/src/renderer/components/layout/ToastContainer.tsx')
            ) {
              return 'app-shell'
            }
            if (
              id.includes(
                '/src/renderer/components/pipeline/PipelineCanvas.tsx'
              )
            ) {
              return 'pipeline-canvas'
            }
            if (
              id.includes('/src/renderer/components/pipeline/WorkflowBoard.tsx')
            ) {
              return 'workflow-board'
            }
            if (
              id.includes(
                '/src/renderer/components/pipeline/WorkflowActionPanel.tsx'
              )
            ) {
              return 'workflow-actions-panel'
            }
            if (
              id.includes('react-router-dom') ||
              id.includes('react-router')
            ) {
              return 'router'
            }
            if (id.includes('zustand')) {
              return 'zustand'
            }
            if (
              id.includes('react-dom') ||
              id.includes('/react/') ||
              id.includes('scheduler')
            ) {
              return 'react-core'
            }
            if (id.includes('node_modules')) {
              return 'vendor'
            }
          }
        }
      },
      minify: true
    }
  }
})
