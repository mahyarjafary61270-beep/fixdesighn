'use strict';

/**
 * The MITM certificate — the one per-machine piece of the domain-fronting profile.
 *
 * The shipped config terminates TLS with a certificate, re-reads the real destination and
 * re-opens the connection under an unblocked front name. Its private key can read every TLS
 * session of any machine that trusts it, so it is MINTED HERE, NEVER SHIPPED: one key inside
 * the installer would let every user read every other user's bank and mail. Each install
 * makes its own, it stays in ~/.mahyarvpn/mitm, and nothing ever sends it anywhere.
 *
 * Made by Xray itself (`xray tls cert -ca`), so the files come back in exactly the format
 * the same core reads again.
 *
 * Trust is the user's to give: the certificate goes into the CURRENT USER's Root store
 * through certutil, and Windows itself asks "Do you want to install this certificate?".
 * Nothing is ever installed machine-wide or silently.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const paths = require('./paths');

const DIR = paths.mitmDir();
const BASE = path.join(DIR, 'mahyarvpn_mitm');
const CERT = BASE + '.crt';
const KEY = BASE + '.key';
const META = path.join(DIR, 'meta.json');
const VALID_HOURS = 20 * 365 * 24;
const CERT_PLACEHOLDER = '__MAHYAR_CERT_PATH__';
const KEY_PLACEHOLDER = '__MAHYAR_KEY_PATH__';

// The shipped profile names its placeholders after MLM VPN; accept both spellings so the
// asset can be updated from upstream without this module having to follow along.
const LEGACY_CERT_PLACEHOLDER = '__MLM_CERT_PATH__';
const LEGACY_KEY_PLACEHOLDER = '__MLM_KEY_PATH__';

function run(exe, args, timeout = 60000, options = {}) {
    return new Promise((resolve) => {
        execFile(exe, args, { timeout, windowsHide: options.windowsHide !== false }, (err, stdout, stderr) => {
            resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
                errorCode: err && err.code, timedOut: !!(err && err.killed),
                out: String(stdout || '') + String(stderr || ''),
                errorMessage: err ? err.message : '' });
        });
    });
}

function ps(command, timeout = 20000) {
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], timeout);
}

function exists() {
    try { return fs.statSync(CERT).size > 0 && fs.statSync(KEY).size > 0; } catch (e) { return false; }
}

function readMeta() {
    try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch (e) { return {}; }
}

/** What the user needs to recognise the entry in Windows' certificate list, or null. */
function certInfo() {
    if (!exists()) return null;
    try {
        const c = new crypto.X509Certificate(fs.readFileSync(CERT));
        const meta = readMeta();
        const cn = meta.cn || ((c.subject.match(/CN=([^\n]+)/) || [])[1] || '');
        return {
            cn,
            createdAt: meta.createdAt || null,
            validTo: c.validTo,
            sha256: c.fingerprint256,
            thumbprint: c.fingerprint.replace(/:/g, '').toUpperCase(),
        };
    } catch (e) {
        return null;
    }
}

/**
 * Xray v26.10.31 generates a PKCS#8 EC key but labels the PEM block
 * "RSA PRIVATE KEY". Node/OpenSSL rejects that label. Parse the DER as PKCS#8
 * if normal PEM parsing fails; do not rewrite or replace the existing key.
 */
function parsePrivateKey(pem) {
    try { return crypto.createPrivateKey(pem); }
    catch (original) {
        const text = Buffer.isBuffer(pem) ? pem.toString('utf8') : String(pem);
        const match = text.match(/^\s*-----BEGIN RSA PRIVATE KEY-----\s*([A-Za-z0-9+/=\r\n]+)\s*-----END RSA PRIVATE KEY-----\s*$/);
        if (!match) throw original;
        try {
            return crypto.createPrivateKey({ key: Buffer.from(match[1].replace(/\s/g, ''), 'base64'), format: 'der', type: 'pkcs8' });
        } catch (_) { throw original; }
    }
}

/** Mint the pair if it is missing. Never overwrites one that exists. */
async function ensure() {
    if (exists()) {
        const info = certInfo();
        if (!info) throw new Error('گواهی موجود معتبر نیست. آن را بررسی کنید؛ فایل‌ها بازنویسی نشدند.');
        const cert = new crypto.X509Certificate(fs.readFileSync(CERT));
        let key;
        try { key = parsePrivateKey(fs.readFileSync(KEY)); }
        catch (_) { throw new Error('خواندن کلید خصوصی ممکن نیست. فایل موجود تغییر داده نشد؛ گواهی و کلید را بررسی کنید.'); }
        if (!cert.ca || !cert.checkPrivateKey(key) || Date.parse(cert.validTo) <= Date.now()) {
            throw new Error('گواهی منقضی، نامعتبر یا ناسازگار با کلید است. فایل‌ها بازنویسی نشدند.');
        }
        return info;
    }
    if (fs.existsSync(CERT) || fs.existsSync(KEY)) throw new Error('فقط بخشی از گواهی موجود است. برای جلوگیری از بازنویسی، ابتدا فایل‌ها را بررسی کنید.');
    paths.ensureDataDir();
    fs.mkdirSync(DIR, { recursive: true });
    // A short random suffix, so two machines never produce identical entries and a second
    // certificate can be told apart from the first in Windows' list.
    const cn = 'Mahyar VPN Local CA ' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const r = await run(paths.xrayExe(), ['tls', 'cert', '-ca', '-json=false', `-name=${cn}`, '-org=Mahyar VPN', `-expire=${VALID_HOURS}h`, `-file=${BASE}`]);
    if (r.code !== 0 || !exists()) throw new Error('ساخت گواهی ناموفق بود' + (r.out ? ': ' + r.out.trim().split('\n').pop() : '.'));
    fs.writeFileSync(META, JSON.stringify({ cn, createdAt: Date.now() }));
    return ensure();
}

/** Does Windows trust this certificate right now? Asked live, never remembered. */
async function isTrusted(info = certInfo()) {
    if (!info) return false;
    const r = await ps(`Test-Path 'Cert:\\CurrentUser\\Root\\${info.thumbprint}'`);
    if (r.code !== 0) throw new Error('بررسی مخزن گواهی ویندوز ناموفق بود: ' + r.out.trim());
    return /True/i.test(r.out);
}
async function isMachineTrusted(info) {
    const r = await ps(`Test-Path 'Cert:\\LocalMachine\\Root\\${info.thumbprint}'`);
    if (r.code !== 0) throw new Error('بررسی مخزن کل سیستم ناموفق بود: ' + r.out.trim());
    return /True/i.test(r.out);
}

/**
 * Put the certificate in the current user's Root store. Windows shows its own confirmation
 * dialog and this waits for the answer. Never report success until the exact
 * thumbprint is found in the current-user root store.
 */
async function trust() {
    const info = await ensure();
    if (await isTrusted(info)) return { trusted: true };
    const result = await run('certutil.exe', ['-user', '-addstore', 'Root', CERT], 10 * 60 * 1000, { windowsHide: false });
    const trusted = await isTrusted(info);
    if (trusted) return { trusted: true };
    const details = result.out.trim().slice(-2500);
    if (result.timedOut) {
        const e = new Error('زمان نصب گواهی تمام شد. پنجره تأیید ویندوز را بررسی کنید و دوباره تلاش کنید.');
        e.code = 'CERT_INSTALL_TIMEOUT'; throw e;
    }
    const e = new Error('گواهی در مخزن کاربر نصب نشد. پنجره تأیید ویندوز، مجوزها و محدودیت‌های سیستم را بررسی کنید.' +
        (details ? '\n\nجزئیات certutil:\n' + details : `\n\nکد خروج: ${result.errorCode ?? result.code}.`));
    e.code = 'CERT_INSTALL_FAILED';
    throw e;
}

/** Take it back out of Windows (the user's store asks again; the machine's, if it is there, does not). */
async function untrust() {
    const info = certInfo();
    if (!info) return { trusted: false };
    const inMachine = await isMachineTrusted(info);
    if (inMachine) throw new Error('این گواهی در مخزن کل سیستم هم وجود دارد. ابتدا آن را دستی از آن مخزن حذف کنید.');
    const result = await run('certutil.exe', ['-user', '-delstore', 'Root', info.thumbprint], 10 * 60 * 1000, { windowsHide: false });
    const trusted = await isTrusted(info);
    if (trusted) {
        const detail = result.out.trim().slice(-2500);
        throw new Error('لغو اعتماد گواهی انجام نشد. فایل‌های گواهی حذف نشدند.' + (detail ? '\n\n' + detail : ''));
    }
    return { trusted: false };
}

/** Remove it from Windows first, then delete the files, so a trusted orphan can never be left behind. */
async function remove() {
    const info = certInfo();
    if (!info && (fs.existsSync(CERT) || fs.existsSync(KEY))) {
        throw new Error('گواهی یا کلید ناقص یا نامعتبر است. برای جلوگیری از باقی‌ماندن CA مورد اعتماد، ابتدا آن را دستی بررسی کنید.');
    }
    if (info && await isMachineTrusted(info)) {
        throw new Error('این گواهی در مخزن کل سیستم وجود دارد. ابتدا آن را دستی از آن مخزن حذف کنید.');
    }
    if (await isTrusted()) {
        const r = await untrust();
        if (r.trusted) return { removed: false, trusted: true };
    }
    for (const f of [CERT, KEY, META]) { try { fs.unlinkSync(f); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
    return { removed: true, trusted: false };
}

/**
 * The runnable config: the shipped file with the certificate placeholders set to this
 * machine's files. Set on the parsed object rather than by text replacement — a Windows
 * path is full of backslashes, which a raw substitution would turn into invalid JSON
 * escapes.
 */
function buildConfig() {
    if (!exists()) return null;
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(paths.mitmConfigAsset(), 'utf8')); } catch (e) { return null; }
    for (const ib of cfg.inbounds || []) {
        const certs = ib && ib.streamSettings && ib.streamSettings.tlsSettings && ib.streamSettings.tlsSettings.certificates;
        for (const c of certs || []) {
            if (!c) continue;
            if (c.certificateFile === CERT_PLACEHOLDER || c.certificateFile === LEGACY_CERT_PLACEHOLDER) c.certificateFile = CERT;
            if (c.keyFile === KEY_PLACEHOLDER || c.keyFile === LEGACY_KEY_PLACEHOLDER) c.keyFile = KEY;
        }
    }
    const out = JSON.stringify(cfg);
    return out.includes(CERT_PLACEHOLDER) || out.includes(KEY_PLACEHOLDER) ||
           out.includes(LEGACY_CERT_PLACEHOLDER) || out.includes(LEGACY_KEY_PLACEHOLDER) ? null : out;
}

async function status() {
    const info = certInfo();
    const trusted = info ? await isTrusted(info) : false;
    return {
        exists: !!info,
        cert: info,
        trusted,
        coreReady: fs.existsSync(paths.xrayExe()),
        // Only once it can actually carry anything: an untrusted certificate makes every
        // fronted site fail with a certificate error in the browser.
        config: info && trusted ? buildConfig() : null,
    };
}

module.exports = { status, ensure, trust, untrust, remove, buildConfig, isTrusted, certInfo, exists, parsePrivateKey, DIR, CERT, KEY, CERT_PLACEHOLDER, KEY_PLACEHOLDER };
