'use strict';

/**
 * The Xray engine — the one thing that carries traffic.
 *
 * The domain-fronting profile ships as a full Xray config (core/mitm/mitm_domainfronting_v23.json).
 * Starting it means: fill in this machine's certificate, give the client listeners the app's
 * own loopback ports, pin the profile's own TLS-decrypt inbounds to loopback, inject the
 * stats API, then spawn the core and — only once its SOCKS inbound actually accepts — turn
 * the Windows proxy on. A start that reported success before the listener existed was the
 * original bug class this whole dance exists to prevent: a green panel over a dead port.
 */

const { spawn, execFile } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const mitmCert = require('./mitm-cert');
const sysproxy = require('./safe-proxy');

// The same ports the profile was written for, kept stable so nothing surprises the user.
const PORTS = {
    socks: 10808,
    http: 10809,
    api: 20085,
    decryptH11: 11666,   // the profile's own TLS-terminating tunnel inbounds
    decryptH211: 11777,
};

const CLIENT_PROTOCOLS = new Set(['socks', 'http', 'mixed']);

let xrayProcess = null;
let trafficInterval = null;
let trafficGeneration = 0;
let lastTraffic = { up: 0, down: 0 };
let totalTraffic = { up: 0, down: 0 };
let startedAt = 0;
let lifecycle = Promise.resolve();
let shuttingDown = false;
let currentConfig = null;
let logBuffer = [];
let onEvent = null;          // (type, payload) => void — the window's push channel

function emit(type, payload) {
    try { if (typeof onEvent === 'function') onEvent(type, payload); } catch (e) { /* the window may be gone */ }
}

function setEventListener(fn) { onEvent = fn; }

function log(line) {
    const stamped = `${new Date().toLocaleTimeString('en-GB')}  ${line}`;
    logBuffer.push(stamped);
    if (logBuffer.length > 500) logBuffer.splice(0, logBuffer.length - 500);
    emit('log', stamped);
    try { console.log(stamped); } catch (e) { /* console may not exist */ }
}

function getLogs() { return logBuffer.slice(); }

/**
 * The runnable config: the shipped profile with this machine's certificate and the app's
 * own loopback listeners, byte for byte otherwise. The profile's own `tunnel` inbounds are
 * its plumbing and stay — dropping them would leave its routing pointing at nothing; they
 * are pinned to loopback so the LAN is never offered a TLS relay.
 */
function buildEngineConfig() {
    const mitmConfig = mitmCert.buildConfig();
    if (!mitmConfig) return null;
    const cfg = JSON.parse(mitmConfig);

    const clientIn = (cfg.inbounds || []).find((i) => i && CLIENT_PROTOCOLS.has(String(i.protocol)));
    const sniffing = (clientIn && clientIn.sniffing) || { enabled: true, destOverride: ['http', 'tls'] };
    const ownIn = (cfg.inbounds || [])
        .filter((i) => i && !CLIENT_PROTOCOLS.has(String(i.protocol)) && i.tag !== 'api')
        .map((i) => Object.assign({}, i, { listen: '127.0.0.1' }));

    cfg.inbounds = [
        { tag: 'client-socks', port: PORTS.socks, listen: '127.0.0.1', protocol: 'socks', settings: { udp: true }, sniffing },
        { tag: 'client-http', port: PORTS.http, listen: '127.0.0.1', protocol: 'http', sniffing },
        { listen: '127.0.0.1', port: PORTS.api, protocol: 'dokodemo-door', settings: { address: '127.0.0.1' }, tag: 'api' },
        ...ownIn,
    ];
    cfg.stats = {};
    cfg.api = { tag: 'api', services: ['StatsService'] };
    if (!cfg.policy) cfg.policy = {};
    cfg.policy.system = { statsInboundUplink: true, statsInboundDownlink: true, statsOutboundUplink: true, statsOutboundDownlink: true };
    if (!cfg.routing) cfg.routing = { rules: [] };
    if (!cfg.routing.rules) cfg.routing.rules = [];
    cfg.routing.rules.unshift({ type: 'field', inboundTag: ['api'], outboundTag: 'api' });

    return cfg;
}

/** Does the core we just spawned actually exist — asked at its own port. */
function waitForXrayUp(port, budgetMs = 6000) {
    const deadline = Date.now() + budgetMs;
    return new Promise((resolve) => {
        const attempt = () => {
            const sock = new net.Socket();
            sock.setTimeout(500);
            const again = () => {
                sock.destroy();
                if (Date.now() >= deadline) return resolve(false);
                setTimeout(attempt, 120);
            };
            sock.once('timeout', again);
            sock.once('error', again);
            sock.once('connect', () => { sock.destroy(); resolve(true); });
            sock.connect(port, '127.0.0.1');
        };
        attempt();
    });
}

/**
 * One figure from Xray's counters, each byte once. Counters are named
 * "inbound|outbound>>>tag>>>traffic>>>uplink|downlink". The 'api' listener is left out —
 * its own once-a-second stats query would otherwise show as ~1 KB/s on an idle connection.
 */
function sumTrafficStats(stats) {
    const t = { inbound: { up: 0, down: 0, seen: false }, outbound: { up: 0, down: 0, seen: false } };
    for (const s of stats || []) {
        const [kind, tag, , dir] = String((s && s.name) || '').split('>>>');
        const side = t[kind];
        if (!side || tag === 'api') continue;
        side.seen = true;
        const v = parseInt(s.value, 10) || 0;
        if (dir === 'uplink') side.up += v;
        else if (dir === 'downlink') side.down += v;
    }
    const pick = t.inbound.seen ? t.inbound : t.outbound;
    return { up: pick.up, down: pick.down };
}

function startTrafficPolling() {
    if (trafficInterval) clearInterval(trafficInterval);
    const generation = ++trafficGeneration;
    let pollPending = false;
    let lastAt = 0;
    trafficInterval = setInterval(() => {
        if (pollPending) return;
        pollPending = true;
        try {
            execFile(paths.xrayExe(), ['api', 'statsquery', `-server=127.0.0.1:${PORTS.api}`], { timeout: 3000, windowsHide: true }, (err, stdout) => {
                pollPending = false;
                if (err || !trafficInterval || generation !== trafficGeneration) return;
                try {
                    const data = JSON.parse(stdout);
                    if (data && data.stat) {
                        const { up, down } = sumTrafficStats(data.stat);
                        const upDiff = Math.max(0, up - lastTraffic.up);
                        const downDiff = Math.max(0, down - lastTraffic.down);
                        const now = Date.now();
                        const elapsed = lastAt ? (now - lastAt) / 1000 : 0;
                        totalTraffic = { up: Math.max(totalTraffic.up, up), down: Math.max(totalTraffic.down, down) };
                        lastTraffic = { up, down };
                        lastAt = now;
                        emit('traffic', { up, down, upSpeed: elapsed ? upDiff / elapsed : 0, downSpeed: elapsed ? downDiff / elapsed : 0, uptime: connectedUptimeMs() });
                    }
                } catch (e) { /* a partial line is not a reason to log */ }
            });
        } catch (e) { pollPending = false; }
    }, 1000);
    if (trafficInterval.unref) trafficInterval.unref();
}

function stopTrafficPolling() {
    trafficGeneration++;
    if (trafficInterval) clearInterval(trafficInterval);
    trafficInterval = null;
    lastTraffic = { up: 0, down: 0 };
}

function connectedUptimeMs() { return startedAt ? Date.now() - startedAt : 0; }

/** Kill whatever xray.exe we own, by PID when we have one. */
async function killXrayProcess() {
    const proc = xrayProcess;
    if (proc && proc.pid) await new Promise((resolve) => {
        execFile('taskkill', ['/F', '/PID', String(proc.pid), '/T'], { windowsHide: true, timeout: 8000 }, () => resolve());
    });
    stopTrafficPolling();
    xrayProcess = null;
}

/**
 * The whole connect, in the one order that is safe:
 *   certificate ready -> config written -> engine up -> system proxy on.
 * Turning the proxy on before the listener exists leaves the browser pointed at a dead port.
 */
async function startImpl() {
    if (xrayProcess) return { ok: true, already: true };

    const exePath = paths.xrayExe();
    if (!fs.existsSync(exePath)) throw new Error('فایل xray.exe در پوشه core پیدا نشد!');

    const cert = await mitmCert.ensure();
    if (!cert) throw new Error('گواهی محلی ساخته نشد.');
    if (!(await mitmCert.isTrusted(cert))) {
        const e = new Error('گواهی هنوز در ویندوز نصب نشده است — ابتدا گواهی را نصب کنید.');
        e.code = 'CERT_NOT_TRUSTED';
        throw e;
    }

    const cfg = buildEngineConfig();
    if (!cfg) throw new Error('ساخت کانفیگ نهایی ناموفق بود — جایگاه‌های گواهی در کانفیگ اصلی پیدا نشدند.');
    currentConfig = JSON.stringify(cfg);

    paths.ensureDataDir();
    const configPath = paths.configPath();
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2));

    log('[ENGINE] اجرای هستهٔ Xray…');
    for (const port of [PORTS.socks, PORTS.http, PORTS.api, PORTS.decryptH11, PORTS.decryptH211]) {
        const free = await new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
        });
        if (!free) throw new Error(`پورت ${port} در حال استفاده است. برنامهٔ دیگر را ببندید و دوباره تلاش کنید.`);
    }
    const proc = spawn(exePath, ['run', '-config', configPath], {
        windowsHide: true, cwd: paths.coreDir(),
        env: { ...process.env, XRAY_LOCATION_ASSET: paths.coreDir() },
    });
    xrayProcess = proc;

    // The core's own explanation, kept so a failed start can quote it instead of guessing.
    let coreSaid = '';
    let coreExited = false;
    const remember = (d) => {
        coreSaid = (coreSaid + d.toString()).slice(-4000);
        d.toString().split('\n').forEach((line) => { if (line.trim()) log('[XRAY] ' + line.trim()); });
    };
    if (proc.stdout) proc.stdout.on('data', remember);
    if (proc.stderr) proc.stderr.on('data', remember);
    proc.on('close', (code) => {
        coreExited = true;
        log(`[ENGINE] هسته با کد ${code} بسته شد.`);
        if (xrayProcess === proc) {
            xrayProcess = null;
            stopTrafficPolling();
            startedAt = 0;
            // The proxy must not outlive the port it points at.
            sysproxy.enableSystemProxy(false, PORTS.http).catch((e) => log('[PROXY] ' + e.message));
            emit('state', state());
        }
    });
    proc.on('error', (err) => log(`[FATAL] خطای اجرای هسته: ${err.message}`));

    const up = await waitForXrayUp(PORTS.socks) && await waitForXrayUp(PORTS.http);
    if (!up || coreExited) {
        const why = (coreSaid.match(/Failed to start:.*/) || coreSaid.match(/^.*\[Error\].*$/m) || [''])[0].trim();
        await killXrayProcess();
        await sysproxy.enableSystemProxy(false, PORTS.http);
        const e = new Error(why
            ? `هستهٔ Xray بالا نیامد — ${why.replace(/^Failed to start:\s*/, '')}`
            : `هستهٔ Xray روی پورت ${PORTS.socks} بالا نیامد.`);
        e.code = 'XRAY_START_FAILED';
        throw e;
    }

    try {
        if (shuttingDown) throw new Error('برنامه در حال خروج است.');
        await sysproxy.enableSystemProxy(true, PORTS.http);
        if (shuttingDown || coreExited || xrayProcess !== proc) throw new Error('هسته هنگام تنظیم پروکسی بسته شد.');
    } catch (error) {
        await sysproxy.enableSystemProxy(false, PORTS.http).catch(() => {});
        await killXrayProcess();
        throw error;
    }
    startedAt = Date.now();
    startTrafficPolling();
    log('[ENGINE] ✅ متصل شد — پروکسی سیستم روی 127.0.0.1:' + PORTS.http + ' تنظیم شد.');
    emit('state', state());
    return { ok: true };
}

/**
 * The whole disconnect, in the one order that is safe: proxy off FIRST (so nothing is
 * pointed at a dying port), then the engine.
 */
async function stopImpl() {
    await sysproxy.enableSystemProxy(false, PORTS.http);
    await killXrayProcess();
    startedAt = 0;
    totalTraffic = { up: 0, down: 0 };
    log('[ENGINE] قطع شد — پروکسی سیستم خاموش شد.');
    emit('state', state());
    return { ok: true };
}

/** Synchronous stop for `before-quit`, which cannot await promises. */
function stopSync() {
    shuttingDown = true;
    try { sysproxy.disableSystemProxySync(); } catch (e) { log('[PROXY] ' + e.message); }
    try {
        if (xrayProcess && xrayProcess.pid) {
            execFile('taskkill', ['/F', '/PID', String(xrayProcess.pid), '/T'], { windowsHide: true, timeout: 8000 }, () => {});
        }
    } catch (e) { /* nothing left to try */ }
    if (trafficInterval) clearInterval(trafficInterval);
    xrayProcess = null;
    startedAt = 0;
}

function serialize(fn) {
    const next = lifecycle.catch(() => {}).then(fn);
    lifecycle = next;
    return next;
}
function start() { return serialize(startImpl); }
function stop() { return serialize(stopImpl); }
function isRunning() { return !!xrayProcess && !!startedAt; }

function state() {
    return {
        running: isRunning(),
        since: startedAt,
        uptime: connectedUptimeMs(),
        traffic: totalTraffic,
        ports: PORTS,
    };
}

module.exports = { start, stop, stopSync, state, isRunning, getLogs, setEventListener, buildEngineConfig, sumTrafficStats, waitForXrayUp, PORTS };
