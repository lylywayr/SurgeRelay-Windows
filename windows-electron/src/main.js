const { app, BrowserWindow, Menu, Tray, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('./server');

let mainWindow = null;
let tray = null;
let runtime = null;

function resourcePath(...segments) {
  return path.join(app.getAppPath(), ...segments);
}

function logStartupError(error) {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'startup.log'),
      `[${new Date().toISOString()}] ${error?.stack || error}\n`
    );
  } catch {
    // Last-ditch logging only; never crash while reporting a crash.
  }
}

async function createMainWindow() {
  runtime = await createServer({
    webRoot: resourcePath('windows-electron', 'web'),
    dataRoot: app.getPath('userData'),
    platform: {
      setLaunchAtLogin(enabled) {
        app.setLoginItemSettings({
          openAtLogin: enabled,
          openAsHidden: true
        });
      }
    }
  });

  mainWindow = new BrowserWindow({
    width: 1240,
    height: 760,
    minWidth: 700,
    title: 'Surge Relay',
    show: false,
    backgroundColor: '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(runtime.url);
}

function createTray() {
  tray = new Tray(resourcePath('windows-electron', 'web', 'app-icon.png'));
  tray.setToolTip('Surge Relay');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Surge Relay', click: showMainWindow },
    {
      label: 'Open Web UI in Browser',
      click: () => runtime && shell.openExternal(runtime.url)
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]));
  tray.on('double-click', showMainWindow);
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await createMainWindow();
  createTray();

  app.on('activate', showMainWindow);
}).catch((error) => {
  logStartupError(error);
  app.quit();
});

process.on('uncaughtException', logStartupError);
process.on('unhandledRejection', logStartupError);

app.on('before-quit', () => {
  app.isQuitting = true;
  if (runtime) runtime.close();
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});
