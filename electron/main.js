const { app, BrowserWindow, shell, ipcMain, Tray, Menu, dialog } = require('electron');
const path = require('path');

const isDev = process.env.OTTERY_DEV === 'true' || !app.isPackaged;

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

  app.whenReady().then(main);
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
  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('update-ready');
  });
  setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 5000);
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
  'id.kick.com',
  'accounts.google.com',
  'accounts.spotify.com',
  'joystick.tv',
];

ipcMain.handle('open-external', async (_event, url) => {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return;
    const allowed = ALLOWED_OAUTH_ORIGINS.some(
      (o) => parsed.hostname === o || parsed.hostname.endsWith('.' + o)
    );
    if (!allowed) return;
    await shell.openExternal(url);
  } catch {
    // Invalid URL — ignore
  }
});

ipcMain.handle('get-version', () => app.getVersion());

ipcMain.handle('check-for-updates', () => {
  if (!isDev) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.checkForUpdatesAndNotify();
  }
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
