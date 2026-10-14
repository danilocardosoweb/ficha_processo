const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const port = Number(process.env.TECNOMES_PORT ?? 3210);
const localUrl = `http://127.0.0.1:${port}`;
const isDevelopment = !app.isPackaged;
let localServer;
let mainWindow;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

function recordServerLifecycle(event, details = {}) {
  try {
    const logDirectory = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDirectory, { recursive: true });
    fs.appendFileSync(path.join(logDirectory, "server-lifecycle.log"), `${JSON.stringify({ at: new Date().toISOString(), event, ...details })}\n`, "utf8");
  } catch (error) {
    console.error("Falha ao registrar o estado do serviço local", error);
  }
}

function localDataDirectory() {
  return path.join(app.getPath("userData"), "data");
}

async function waitForLocalServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (localServer?.exitCode !== null && localServer?.exitCode !== undefined) {
      throw new Error(`O serviço local encerrou durante a inicialização (código ${localServer.exitCode}).`);
    }
    if (localServer?.signalCode) throw new Error(`O serviço local foi encerrado durante a inicialização (${localServer.signalCode}).`);
    const available = await new Promise((resolve) => {
      const request = http.get(`${localUrl}/api/local/status`, (response) => {
        response.resume();
        resolve(Boolean(response.statusCode && response.statusCode < 500));
      });
      request.on("error", () => resolve(false));
      request.setTimeout(1_000, () => request.destroy());
    });
    if (available) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("O serviço local não iniciou em 60 segundos.");
}

function startLocalServer() {
  if (isDevelopment) return Promise.resolve();
  const serverFile = path.join(process.resourcesPath, "next", "server.js");
  if (!fs.existsSync(serverFile)) throw new Error(`Servidor local não encontrado: ${serverFile}`);

  localServer = spawn(process.execPath, [serverFile], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      TECNOMES_LOCAL_MODE: "true",
      TECNOMES_APP_ENVIRONMENT: "desktop",
      TECNOMES_DATA_DIR: localDataDirectory(),
    },
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });
  recordServerLifecycle("started", { pid: localServer.pid, port });
  const logDirectory = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDirectory, { recursive: true });
  const serverErrorLog = fs.createWriteStream(path.join(logDirectory, "server-process.log"), { flags: "a" });
  localServer.stderr?.pipe(serverErrorLog);
  localServer.once("error", (error) => {
    recordServerLifecycle("process_error", { code: error.code, message: error.message });
    console.error("Falha ao iniciar o serviço local", error);
  });
  localServer.once("exit", (code, signal) => {
    recordServerLifecycle("exited", { code, signal });
    serverErrorLog.end();
  });
  return waitForLocalServer();
}

function createWindow() {
  const window = new BrowserWindow({
    minWidth: 1024,
    minHeight: 700,
    width: 1440,
    height: 900,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f8f7f4",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.on("closed", () => { mainWindow = undefined; });

  window.setMenuBarVisibility(false);
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(localUrl)) event.preventDefault();
  });
  return window.loadURL(localUrl);
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  fs.mkdirSync(localDataDirectory(), { recursive: true });
  process.env.TECNOMES_DATA_DIR = localDataDirectory();
  process.env.TECNOMES_LOCAL_MODE = "true";
  process.env.TECNOMES_APP_ENVIRONMENT = "desktop";

  ipcMain.handle("tecnomes:app-info", () => ({
    version: app.getVersion(),
    mode: "local",
    packaged: app.isPackaged,
  }));

  await startLocalServer();
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (localServer && !localServer.killed) localServer.kill();
});
