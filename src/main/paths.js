'use strict';

// Reconstructed: the original paths.js could not be extracted from the supplied RAR.
const fs = require('fs');
const path = require('path');
const os = require('os');

function dataDir() { return path.join(os.homedir(), '.mahyarvpn'); }
function ensureDataDir() { fs.mkdirSync(dataDir(), { recursive: true }); }
function coreDir() {
    return process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'core'))
        ? path.join(process.resourcesPath, 'core')
        : path.join(__dirname, '..', '..', 'resources', 'core');
}
function xrayExe() { return path.join(coreDir(), 'xray.exe'); }
function mitmConfigAsset() { return path.join(coreDir(), 'mitm', 'mitm_domainfronting_v23.json'); }
function mitmDir() { return path.join(dataDir(), 'mitm'); }
function configPath() { return path.join(dataDir(), 'runtime-config.json'); }
module.exports = { dataDir, ensureDataDir, coreDir, xrayExe, mitmConfigAsset, mitmDir, configPath };
