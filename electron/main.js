const { app, BrowserWindow, shell, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');

const isDev = process.env.OTTERY_DEV === 'true' || !app.isPackaged;

// Surface fatal startup errors instead of dying silently. On a packaged
// Windows GUI app there is no console, so an unhandled rejection in main()
// (e.g. a native-module ABI mismatch in better-sqlite3/keytar) would
// otherwise show no window, no dialog, and no feedback at all.
function reportFatal(context, err) {
  try {
    const logger = require('../server/lib/logger');
    logger.error(`[fatal] ${context}:`, err);
  } catch { /* logger itself may be unavailable */ }
  try {
    dialog.showErrorBox(
      'Ottery Live failed to start',
      `${context}\n\n${(err && err.stack) || err}\n\n` +
      `Logs: ${app.getPath('logs')}`
    );
  } catch { /* dialog unavailable before ready — nothing more we can do */ }
  app.exit(1);
}

process.on('uncaughtException', (err) => reportFatal('Uncaught exception', err));
process.on('unhandledRejection', (err) => reportFatal('Unhandled rejection', err));

let mainWindow;
let tray;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find(arg => arg.startsWith('ottery-live://'));
    if (url) handleOAuthCallback(url);
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });

  app.whenReady().then(main).catch((err) => reportFatal('Startup failed', err));
}

async function main() {
  if (isDev) {
    // In dev mode the server runs as a separate nodemon process.
    // Electron is just a browser window — skip server startup and port check.
    const serverPort = parseInt(process.env.OTTERY_SERVER_PORT || '3737', 10);
    createWindow(serverPort);
    registerUriScheme();
    return;
  }

  try {
    const { checkPorts } = require('../server/lib/port-check');
    const portIssues = await checkPorts();
    if (portIssues.length > 0) {
      dialog.showErrorBox(
        'Port Conflict',
        portIssues.join('\n') + '\n\nChange ports in Settings and restart Ottery Live.'
      );
      app.quit();
      return;
    }
  } catch (err) {
    // Non-fatal — continue startup
    console.error('Port check failed:', err);
  }

  const { startServer } = require('../server');
  await startServer();

  const settings = require('../server/settings');
  const serverPort = await settings.get('server.port');
  process.env.OTTERY_SERVER_PORT = String(serverPort);

  createWindow(serverPort);
  registerUriScheme();
  setupTray();

  const { autoUpdater } = require('electron-updater');
  const logger = require('../server/lib/logger');
  // A failed update check (no published release yet, offline, 404 on latest.yml)
  // must never take down the app. electron-updater emits 'error' on an
  // EventEmitter — with no listener Node throws it as an uncaught exception,
  // which the fatal handler above would then turn into an app exit.
  autoUpdater.on('error', (err) => {
    logger.warn('[updater] update check failed (non-fatal):', (err && err.message) || err);
  });
  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('update-ready');
  });
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      logger.warn('[updater] checkForUpdatesAndNotify rejected (non-fatal):', (err && err.message) || err);
    });
  }, 5000);
}

function buildAppMenu(serverPort) {
  const isMac = process.platform === 'darwin';

  const template = [
    // macOS requires the first menu to be the app menu
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open Help Guide',
          accelerator: isMac ? 'Cmd+Shift+H' : 'F1',
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
              mainWindow.webContents.send('navigate', `/ottery-live/help`);
            }
          },
        },
        { type: 'separator' },
        {
          label: `Ottery Live v${app.getVersion()}`,
          enabled: false,
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(serverPort) {
  buildAppMenu(serverPort);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    icon: path.join(__dirname, '../assets/icon.png'),
  });

  const url = isDev
    ? 'http://localhost:4200'
    : `http://localhost:${serverPort}`;

  mainWindow.loadURL(url);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools();
  });

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

function setupTray() {
  const iconPath = path.join(__dirname, '../assets/tray-icon.png');
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('Ottery Live');
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: 'Open Dashboard',
        click: () => { mainWindow.show(); mainWindow.focus(); },
      },
      { type: 'separator' },
      {
        label: 'Quit Ottery Live',
        click: () => { mainWindow.destroy(); app.quit(); },
      },
    ]));
    tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
  } catch (err) {
    console.warn('Tray icon failed to load (missing asset?):', err.message);
  }
}

function registerUriScheme() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('ottery-live', process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient('ottery-live');
  }

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleOAuthCallback(url);
  });
}

function handleOAuthCallback(url) {
  if (mainWindow) {
    mainWindow.webContents.send('oauth-callback', url);
  }
}

const ALLOWED_OAUTH_ORIGINS = [
  'id.twitch.tv',
  'www.twitch.tv',
  'twitch.tv',
  'id.kick.com',
  'accounts.google.com',
  'accounts.spotify.com',
  'joystick.tv',
];

ipcMain.handle('open-external', async (_event, url) => {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return false;
    const allowed = ALLOWED_OAUTH_ORIGINS.some(
      (o) => parsed.hostname === o || parsed.hostname.endsWith('.' + o)
    );
    if (!allowed) return false;
    await shell.openExternal(url);
    return true;
  } catch (err) {
    console.error('[open-external] failed to open URL:', err.message);
    return false;
  }
});

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('check-for-updates', async () => {
  if (!isDev) {
    const { autoUpdater } = require('electron-updater');
    try {
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      // Manual update check failed — report to the caller, never crash.
      return { ok: false, error: (err && err.message) || String(err) };
    }
  }
  return { ok: true };
});

ipcMain.handle('open-log-folder', async () => {
  const fs = require('fs');
  const logsPath = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logsPath, { recursive: true });
  await shell.openPath(logsPath);
});

ipcMain.on('restart-for-update', () => {
  if (!isDev) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.quitAndInstall();
  }
});

app.on('window-all-closed', () => {
  // Intentionally empty — tray keeps the app alive
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});
