'use strict';

// LEGACY: retained from the original archive for reference only. The engine uses
// safe-proxy.js instead. Do not call this module: it overwrites system settings.
/**
 * The Windows system proxy (WinINET), driven through the registry.
 *
 * The queue is not cosmetic. Three `reg add` calls are three process spawns on both the
 * connect and the disconnect path, inside Electron's MAIN process — writes must be
 * serialised so "off" can never land after an "on" that was asked for later.
 *
 * The bypass list is part of the contract: loopback is always bypassed (a local proxy
 * reaching another local service through itself is never what anyone wants), and every
 * host this app itself must reach stays outside the proxy.
 */

const { execFile, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let proxyQueue = Promise.resolve();
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

function regAdd(args) {
    return new Promise((resolve) => {
        execFile('reg', ['add', REG_KEY, ...args], { windowsHide: true, timeout: 8000 }, () => resolve());
    });
}

/**
 * Enable or disable the system proxy. Fire-and-forget by contract; the returned promise
 * carries the ordering guarantee.
 */
function enableSystemProxy(enable, port, { bypass = [] } = {}) {
    proxyQueue = proxyQueue.then(async () => {
        try {
            if (enable) {
                const override = ['<local>', 'localhost', '127.*', ...bypass].join(';');
                await regAdd(['/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f']);
                await regAdd(['/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `127.0.0.1:${port}`, '/f']);
                await regAdd(['/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', override, '/f']);
            } else {
                await regAdd(['/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '0', '/f']);
            }
            await refreshWinInet();
        } catch (e) {
            console.error('System Proxy Error:', e.message);
        }
    });
    return proxyQueue;
}

/** Tell WinINET to re-read the registry; without this a browser keeps the old setting until restarted. */
async function refreshWinInet() {
    const psScript = `
$signature = @'
[DllImport("wininet.dll")]
public static extern bool InternetSetOption(int hInternet, int dwOption, int lpBuffer, int dwBufferLength);
'@
$type = Add-Type -MemberDefinition $signature -Name wininet -Namespace mahyarproxy -PassThru
$type::InternetSetOption(0, 39, 0, 0)
$type::InternetSetOption(0, 37, 0, 0)
`;
    // A per-call filename, removed when it has run: two overlapping proxy changes must never
    // race on one script file, with the loser executing a half-written script.
    const scriptPath = path.join(os.tmpdir(), `mahyar_refresh_proxy_${process.pid}_${Date.now()}.ps1`);
    await new Promise((resolve) => { fs.writeFile(scriptPath, psScript, () => resolve()); });
    await new Promise((resolve) => {
        execFile('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
            { windowsHide: true, timeout: 15000 }, () => {
                fs.unlink(scriptPath, () => {});
                resolve();
            });
    });
}

/**
 * Switch the Windows proxy off, blocking until it is off.
 *
 * The ONLY correct caller is a teardown that cannot await a promise — `before-quit` and any
 * synchronous shutdown. Leaving the proxy pointing at a port that dies with this process is
 * not a broken VPN, it is a PC with no internet and no visible cause, so here the block is
 * the point.
 */
function disableSystemProxySync() {
    try {
        execSync(`reg add "${REG_KEY}" /v ProxyEnable /t REG_DWORD /d 0 /f`, { stdio: 'ignore', timeout: 8000 });
    } catch (e) { /* the refresh below still helps, and there is nothing else to try */ }
    try {
        execSync('rundll32.exe wininet.dll,InternetSetOption 0 39 0 0', { stdio: 'ignore', timeout: 8000 });
    } catch (e) { /* best effort: the registry value is what actually matters */ }
}

/** Read ProxyEnable back — used by the smoke test to prove the off path really ran. */
function proxyEnabledSync() {
    try {
        const out = execSync(`reg query "${REG_KEY}" /v ProxyEnable`, { encoding: 'utf8', timeout: 8000 });
        return /0x1/.test(out);
    } catch (e) { return false; }
}

module.exports = { enableSystemProxy, disableSystemProxySync, proxyEnabledSync, refreshWinInet, REG_KEY };
