'use strict';

/**
 * The window's one bridge to the engine. Everything the renderer may ask is explicit;
 * nothing else crosses.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mahyar', {
    // certificate + engine
    mitmStatus: () => ipcRenderer.invoke('mitm:status'),
    mitmSetup: () => ipcRenderer.invoke('mitm:setup'),
    mitmTrust: () => ipcRenderer.invoke('mitm:trust'),
    mitmUntrust: () => ipcRenderer.invoke('mitm:untrust'),
    mitmRemove: () => ipcRenderer.invoke('mitm:remove'),
    mitmOpenFolder: () => ipcRenderer.invoke('mitm:open-folder'),
    engineStart: () => ipcRenderer.invoke('engine:start'),
    engineStop: () => ipcRenderer.invoke('engine:stop'),
    engineState: () => ipcRenderer.invoke('engine:state'),
    engineLogs: () => ipcRenderer.invoke('engine:logs'),

    // pushes
    onState: (cb) => ipcRenderer.on('push:state', (e, s) => cb(s)),
    onTraffic: (cb) => ipcRenderer.on('push:traffic', (e, t) => cb(t)),

    // window chrome
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
    hide: () => ipcRenderer.invoke('win:hide'),
    quit: () => ipcRenderer.invoke('win:quit'),
});
