'use strict';
// Refuse to overwrite an active proxy. Restore only settings owned by this process.
const { execFileSync } = require('child_process');
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
let snapshot = null;
let ownedServer = null;
let queue = Promise.resolve();
let shuttingDown = false;
function reg(args, allowMissing = false) {
    try { return execFileSync('reg.exe', args, { encoding: 'utf8', windowsHide: true, timeout: 8000 }); }
    catch (e) { if (allowMissing && e.status === 1) return ''; throw e; }
}
function read(name) {
    const output = reg(['query', REG_KEY, '/v', name], true);
    const match = output.match(new RegExp('^\\s*' + name + '\\s+(REG_\\w+)\\s+(.*?)\\s*$', 'im'));
    return match ? { type: match[1], value: match[2] } : null;
}
function write(name, item) {
    if (!item) { if (read(name)) reg(['delete', REG_KEY, '/v', name, '/f']); return; }
    reg(['add', REG_KEY, '/v', name, '/t', item.type, '/d', item.value, '/f']);
}
function refresh() {
    const script = `$s='[DllImport("wininet.dll")] public static extern bool InternetSetOption(int h,int o,int b,int l);'; $t=Add-Type -MemberDefinition $s -Name WinInet -Namespace MahyarVPN -PassThru; $null=$t::InternetSetOption(0,39,0,0); $null=$t::InternetSetOption(0,37,0,0)`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, stdio: 'ignore' });
}
function enable(port, bypass = []) {
    if (shuttingDown) throw new Error('برنامه در حال خروج است.');
    if (snapshot) return;
    const before = { ProxyEnable: read('ProxyEnable'), ProxyServer: read('ProxyServer'), ProxyOverride: read('ProxyOverride') };
    if (before.ProxyEnable && Number(before.ProxyEnable.value) !== 0) throw new Error('یک پروکسی سیستم از قبل فعال است. ابتدا آن را غیرفعال کنید.');
    snapshot = before;
    ownedServer = `127.0.0.1:${port}`;
    try {
        write('ProxyServer', { type: 'REG_SZ', value: ownedServer });
        write('ProxyOverride', { type: 'REG_SZ', value: ['<local>', 'localhost', '127.*', ...bypass].join(';') });
        write('ProxyEnable', { type: 'REG_DWORD', value: '1' });
        refresh();
    } catch (err) {
        try { restore(true); } catch (_) {}
        throw err;
    }
}
function restore(force = false) {
    if (!snapshot) return;
    const current = read('ProxyServer');
    if (!force && (!current || current.value !== ownedServer)) { snapshot = null; ownedServer = null; return; }
    write('ProxyEnable', { type: 'REG_DWORD', value: '0' });
    write('ProxyServer', snapshot.ProxyServer);
    write('ProxyOverride', snapshot.ProxyOverride);
    write('ProxyEnable', snapshot.ProxyEnable);
    refresh();
    snapshot = null; ownedServer = null;
}
function enableSystemProxy(on, port, options = {}) {
    const next = queue.catch(() => {}).then(() => on ? enable(port, options.bypass) : restore());
    queue = next;
    return next;
}
function disableSystemProxySync() { shuttingDown = true; restore(); }
function proxyEnabledSync() { const v = read('ProxyEnable'); return !!v && Number(v.value) !== 0; }
module.exports = { enableSystemProxy, disableSystemProxySync, proxyEnabledSync, REG_KEY };
