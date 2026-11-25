import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { app, BrowserWindow, protocol, session, shell } from 'electron'
import { is } from '@electron-toolkit/utils'
import { allowExternalHttps } from './allowlist'

const APP_PROTOCOL = 'wiskbot'
const APP_HOST = 'app'

/** Only these hosts may be opened in the user's browser, and only over HTTPS. */
const EXTERNAL_HTTPS_ALLOWLIST = [
  'github.com',
  'docs.github.com',
  'electronjs.org',
  'electron-vite.org',
  'react.dev',
  'nodejs.org',
  'apache.org',
  'developer.mozilla.org',
  'ai-sdk.dev'
]

export let mainWindow: BrowserWindow | null = null

function contentSecurityPolicy(): string {
  const connectSrc = is.dev ? "'self' ws: http://localhost:*" : "'self'"
  return [
    "default-src 'self' wiskbot:",
    "script-src 'self' wiskbot:",
    "style-src 'self' 'unsafe-inline' wiskbot:",
    "img-src 'self' wiskbot: data:",
    `connect-src ${connectSrc}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

export function applyCspHeaders(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(details.responseHeaders ?? {})) {
      if (key.toLowerCase() !== 'content-security-policy') headers[key] = value
    }
    headers['Content-Security-Policy'] = [contentSecurityPolicy()]
    callback({ responseHeaders: headers })
  })
}

export function registerAppProtocol(): void {
  protocol.registerFileProtocol(APP_PROTOCOL, (request, callback) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      callback({ error: -6 })
      return
    }
    if (url.host !== APP_HOST) {
      callback({ error: -6 })
      return
    }

    const rendererDir = join(__dirname, '../renderer')
    const requested = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const filePath = resolve(rendererDir, requested)
    const indexFile = join(rendererDir, 'index.html')
    if (filePath !== indexFile && !filePath.startsWith(rendererDir + sep)) {
      callback({ error: -6 })
      return
    }
    callback({ path: filePath })
  })
}

export function installWebContentsGuards(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  // Navigation is limited to our own origin; everything else is denied.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, targetUrl) => {
      if (!isTrustedRendererUrl(targetUrl)) {
        event.preventDefault()
        maybeOpenExternal(targetUrl)
      }
    })
    contents.setWindowOpenHandler((details) => {
      maybeOpenExternal(details.url)
      return { action: 'deny' }
    })
  })
}

function isTrustedRendererUrl(url: string): boolean {
  try {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (is.dev && devUrl) return url.startsWith(devUrl)
    const parsed = new URL(url)
    return parsed.protocol === `${APP_PROTOCOL}:` && parsed.host === APP_HOST
  } catch {
    return false
  }
}

function maybeOpenExternal(url: string): void {
  const approved = allowExternalHttps(url, EXTERNAL_HTTPS_ALLOWLIST)
  if (approved) void shell.openExternal(approved)
}

function preloadPath(): string {
  // Sandboxed preload must be CJS. electron-vite 6 emits index.cjs when the
  // preload build is configured with lib.formats: ['cjs'].
  const candidates = ['index.cjs', 'index.js', 'index.mjs'].map((name) =>
    join(__dirname, '../preload', name)
  )
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

export function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'WiskBot',
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow = window
  window.on('closed', () => {
    mainWindow = null
  })
  window.on('ready-to-show', () => window.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadURL(`${APP_PROTOCOL}://${APP_HOST}/index.html`)
  }
  return window
}

export function focusWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}
