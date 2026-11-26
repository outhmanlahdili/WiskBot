import { app, BrowserWindow, dialog, Menu, protocol } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import { initializeDatabase } from './database'
import { registerIpcHandlers } from './ipc'
import { ensureBuiltinSkill } from './skills'
import { logger } from './logger'
import {
  applyCspHeaders,
  createWindow,
  focusWindow,
  installWebContentsGuards,
  registerAppProtocol
} from './window'

// A standard, secure scheme gives the renderer a real origin, so CSP 'self'
// correctly matches assets served by our custom protocol.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wiskbot',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.wiskbot.app')
    Menu.setApplicationMenu(null)

    try {
      initializeDatabase()
    } catch (error) {
      logger.error('bootstrap', error)
      dialog.showErrorBox(
        'WiskBot could not start',
        'The local database could not be initialised. Details were written to the console.'
      )
      app.quit()
      return
    }

    try {
      ensureBuiltinSkill()
    } catch (error) {
      logger.error('skills', error)
    }

    applyCspHeaders()
    registerAppProtocol()
    installWebContentsGuards()
    registerIpcHandlers()
    createWindow()

    app.on('second-instance', () => focusWindow())

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
