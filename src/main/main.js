'use strict';

/**
 * Mahyar VPN — Electron main process.
 *
 * One window, one tray icon, one engine, one capability: the MITM domain-fronting profile.
 * The lifecycle rules that matter:
 *   · single instance — two engines would fight over one SOCKS port;
 *   · closing the window hides to tray and keeps the tunnel (a VPN that dies with its
 *     window is a VPN the user did not ask to turn off); quitting goes through the tray;
 *   · on quit, the proxy goes off synchronously BEFORE the engine dies, never after.
 */

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const engine = require('./engine');
const mitmCert = require('./mitm-cert');

let win = null;
let tray = null;
let quitting = false;

const isDev = !__dirname.includes('app.asar');

function iconPath() {
    return path.join(__dirname, '..', 'renderer', 'icon.png');
}

function trayImage() {
    try {
        const img = nativeImage.createFromPath(iconPath());
        if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
    } catch (e) { /* fall through to an empty image */ }
    return nativeImage.createEmpty();
}

function sendState() {
    try { if (win && !win.isDestroyed()) win.webContents.send('push:state', engine.state()); } catch (e) {}
}

function sendTraffic(t) {
    try { if (win && !win.isDestroyed()) win.webContents.send('push:traffic', t); } catch (e) {}
}

function createWindow() {
    win = new BrowserWindow({
        width: 960,
        height: 680,
        minWidth: 860,
        minHeight: 600,
        show: false,
        frame: false,
        backgroundColor: '#070b12',
        icon: iconPath(),
        title: 'Mahyar VPN',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
        },
    });

    win.loadFile(path.join(__dirname, '..', 'renderer', 'neon.html'));

    win.once('ready-to-show', () => win.show());

    // The red button hides to tray; a VPN that closes with its window surprises nobody
    // once, then kills their connection at the worst moment. Quitting is the tray's job.
    win.on('close', (e) => {
        if (!quitting) {
            e.preventDefault();
            win.hide();
        }
    });
}

function createTray() {
    tray = new Tray(trayImage());
    const menu = Menu.buildFromTemplate([
        { label: 'نمایش Mahyar VPN', click: () => { if (win) { win.show(); win.focus(); } } },
        { type: 'separator' },
        { label: 'اتصال', click: () => engine.start().catch(() => {}) },
        { label: 'قطع اتصال', click: () => engine.stop().catch(() => {}) },
        { type: 'separator' },
        {
            label: 'خروج کامل',
            click: () => { quitting = true; app.quit(); },
        },
    ]);
    tray.setToolTip('Mahyar VPN');
    tray.setContextMenu(menu);
    tray.on('double-click', () => { if (win) { win.show(); win.focus(); } });
}

// ── IPC ────────────────────────────────────────────────────────────────────────────────────

function reply(fn) {
    return async (...args) => {
        try {
            return { ok: true, data: await fn(...args) };
        } catch (e) {
            return { ok: false, error: e.message || String(e), code: e.code || null };
        }
    };
}

ipcMain.handle('mitm:status', reply(() => mitmCert.status()));
ipcMain.handle('mitm:open-folder', reply(async () => {
    fs.mkdirSync(mitmCert.DIR, { recursive: true });
    const err = await shell.openPath(mitmCert.DIR);
    if (err) throw new Error(err);
}));
ipcMain.handle('mitm:setup', reply(async () => {
    const r = await mitmCert.ensure();
    return Object.assign(await mitmCert.status(), { created: !!r });
}));
ipcMain.handle('mitm:trust', reply(async () => {
    const r = await mitmCert.trust();
    return Object.assign(await mitmCert.status(), { declined: !!r.declined });
}));
ipcMain.handle('mitm:untrust', reply(async () => {
    if (engine.isRunning()) { const e = new Error('دامین‌فرانتینگ الان وصل است — اول قطعش کنید.'); e.code = 'BUSY'; throw e; }
    const r = await mitmCert.untrust();
    return Object.assign(await mitmCert.status(), r);
}));
ipcMain.handle('mitm:remove', reply(async () => {
    if (engine.isRunning()) { const e = new Error('دامین‌فرانتینگ الان وصل است — اول قطعش کنید.'); e.code = 'BUSY'; throw e; }
    const r = await mitmCert.remove();
    return Object.assign(await mitmCert.status(), { removed: r.removed });
}));
ipcMain.handle('engine:start', reply(() => engine.start()));
ipcMain.handle('engine:stop', reply(() => engine.stop()));
ipcMain.handle('engine:state', reply(() => engine.state()));
ipcMain.handle('engine:logs', reply(() => engine.getLogs()));

ipcMain.handle('win:minimize', reply(() => { if (win) win.minimize(); }));
ipcMain.handle('win:toggleMaximize', reply(() => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
}));
ipcMain.handle('win:hide', reply(() => { if (win) win.hide(); }));
ipcMain.handle('win:quit', reply(() => { quitting = true; app.quit(); }));

// ── app lifecycle ──────────────────────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    });

    engine.setEventListener((type, payload) => {
        if (type === 'state') sendState();
        else if (type === 'traffic') sendTraffic(payload);
        // log lines already reach the window through engine's own emit — kept off this path
    });

    app.whenReady().then(() => {
        createWindow();
        createTray();
        try { console.log('[APP] Mahyar VPN ready'); } catch (e) {}
    });

    app.on('window-all-closed', () => {
        // tray keeps the app alive; nothing to do here
    });

    app.on('before-quit', () => {
        // The proxy is written off synchronously, BEFORE the engine's port dies — a quit
        // that leaves the system proxy on a dead port is a PC with no internet.
        engine.stopSync();
    });
}
