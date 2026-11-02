'use strict';

/* Mahyar VPN renderer — the state machine of one screen.
 *
 * The order is not cosmetic: the config cannot carry a byte until the certificate it
 * terminates TLS with is one this machine trusts, so the power button stays disabled and
 * the status line says which step is next until the setup is done. */

const $ = (id) => document.getElementById(id);

const state = {
    mitm: null,
    engine: null,
    busy: null,
    traffic: null,
    lastPushAt: 0,
};

const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);

function fmtBytes(b) {
    b = Number(b) || 0;
    if (b >= 1024 ** 3) return fa((b / 1024 ** 3).toFixed(2)) + ' GB';
    if (b >= 1024 ** 2) return fa((b / 1024 ** 2).toFixed(1)) + ' MB';
    if (b >= 1024) return fa((b / 1024).toFixed(1)) + ' KB';
    return fa(b) + ' B';
}

function fmtSpeed(b) {
    b = Number(b) || 0;
    if (b >= 1024 ** 2) return fa((b / 1024 ** 2).toFixed(1)) + ' <small>MB/s</small>';
    if (b >= 1024) return fa((b / 1024).toFixed(0)) + ' <small>KB/s</small>';
    return fa(b) + ' <small>B/s</small>';
}

function fmtUptime(ms) {
    const s = Math.floor((ms || 0) / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return fa(`${h}:${m}:${sec}`);
}

let toastTimer = null;
function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 4200);
}

function setBusy(kind) {
    state.busy = kind;
    document.querySelectorAll('[data-act]').forEach((b) => {
        b.disabled = !!kind && b.dataset.act !== kind;
    });
    render();
}

function clearBusy() { state.busy = null; render(); }

function ready() {
    return !!(state.mitm && state.mitm.exists && state.mitm.trusted && state.mitm.coreReady !== false);
}

function render() {
    const m = state.mitm || { exists: false, trusted: false, cert: null };
    const on = !!(state.engine && state.engine.running);

    const hero = document.querySelector('.hero');
    hero.classList.toggle('on', on);
    hero.classList.toggle('is-busy', !!state.busy);
    hero.classList.toggle('connecting', state.busy === 'connect');
    hero.classList.toggle('disconnecting', state.busy === 'disconnect');
    const head = $('st-head'), sub = $('st-sub'), power = $('btn-power');
    const powerLabel = $('power-label');

    if (state.busy === 'connect') {
        head.textContent = 'در حال اتصال…'; sub.textContent = 'در انتظار آماده‌شدن هسته و پروکسی محلی…'; powerLabel.textContent = 'CONNECTING'; power.disabled = true;
    } else if (state.busy === 'disconnect') {
        head.textContent = 'در حال قطع…'; sub.textContent = 'پروکسی محلی در حال خاموش‌شدن است…'; powerLabel.textContent = 'DISCONNECTING'; power.disabled = true;
    } else if (on) {
        head.textContent = 'پروکسی فعال است';
        sub.textContent = 'هسته و پروکسی محلی فعال‌اند. دسترسی واقعی به سایت را جداگانه بررسی کنید.';
        powerLabel.textContent = 'CONNECTED';
        power.disabled = !!state.busy;
    } else if (m.coreReady === false) {
        head.textContent = 'هسته Xray پیدا نشد';
        sub.textContent = 'فایل‌های هسته را طبق راهنمای ساخت دریافت کنید، سپس برنامه را دوباره باز کنید.';
        powerLabel.textContent = 'UNAVAILABLE';
        power.disabled = true;
    } else if (!m.exists) {
        head.textContent = 'آماده اتصال';
        sub.textContent = 'اول گواهی را بسازید؛ بعد نصبش کنید.';
        powerLabel.textContent = 'CONNECT';
        power.disabled = true;
    } else if (!m.trusted) {
        head.textContent = 'یک قدم مانده';
        sub.textContent = 'گواهی ساخته شده ولی هنوز در ویندوز نصب نشده — بدون آن هر سایتی خطای گواهی می‌دهد.';
        powerLabel.textContent = 'CONNECT';
        power.disabled = true;
    } else {
        head.textContent = 'آماده اتصال';
        sub.textContent = 'همه‌چیز آماده است — دکمه را بزنید.';
        powerLabel.textContent = 'CONNECT';
        power.disabled = !!state.busy;
    }

    const up = $('chip-uptime'), live = $('chip-live');
    if (on) {
        up.textContent = '⏱ ' + fmtUptime(state.engine.uptime || 0);
        up.classList.remove('hidden');
        live.classList.remove('hidden');
    } else {
        up.classList.add('hidden');
        live.classList.add('hidden');
    }

    // setup steps
    const mintDot = document.querySelector('#step-mint .step-dot');
    const trustDot = document.querySelector('#step-trust .step-dot');
    mintDot.dataset.state = m.exists ? 'done' : (state.busy === 'setup' ? 'active' : 'idle');
    trustDot.dataset.state = m.trusted ? 'done' : (m.exists ? (state.busy === 'trust' ? 'active' : 'idle') : 'idle');

    const pillSetup = $('pill-setup');
    if (m.exists && m.trusted) { pillSetup.textContent = 'کامل شد'; pillSetup.className = 'pill ok'; }
    else if (!m.exists) { pillSetup.textContent = '۱ از ۲'; pillSetup.className = 'pill warn'; }
    else { pillSetup.textContent = '۲ از ۲'; pillSetup.className = 'pill warn'; }

    // cert card
    const pillCert = $('pill-cert');
    if (m.exists && m.trusted) { pillCert.textContent = 'نصب شده'; pillCert.className = 'pill ok'; }
    else if (m.exists) { pillCert.textContent = 'نصب نشده'; pillCert.className = 'pill err'; }
    else { pillCert.textContent = 'ساخته نشده'; pillCert.className = 'pill'; }
    $('cert-cn').textContent = m.cert ? m.cert.cn : '—';
    $('cert-exp').textContent = m.cert ? new Date(m.cert.validTo).toLocaleDateString('fa-IR') : '—';
    $('cert-sha').textContent = m.cert ? m.cert.sha256.slice(0, 47) + '…' : '—';
    document.querySelector('[data-act="remove"]').disabled = !m.exists || on || !!state.busy;
    document.querySelector('[data-act="setup"]').disabled = m.exists || m.coreReady === false || !!state.busy;
    document.querySelector('[data-act="trust"]').disabled = !m.exists || m.trusted || !!state.busy;
    document.querySelector('[data-act="openfile"]').disabled = !!state.busy;

    // traffic
    const t = state.traffic || {};
    if (on && state.traffic && Date.now() - state.lastPushAt < 5000) {
        $('spd-down').innerHTML = fmtSpeed(t.downSpeed || 0);
        $('spd-up').innerHTML = fmtSpeed(t.upSpeed || 0);
        $('tot-down').textContent = 'مجموع: ' + fmtBytes(t.down || 0);
        $('tot-up').textContent = 'مجموع: ' + fmtBytes(t.up || 0);
        const pillT = $('pill-traffic');
        pillT.textContent = 'زنده'; pillT.className = 'pill ok';
    } else if (on) {
        $('spd-down').textContent = '—';
        $('spd-up').textContent = '—';
        $('tot-down').textContent = 'آمار دریافت نشده';
        $('tot-up').textContent = 'آمار دریافت نشده';
        $('pill-traffic').textContent = 'نامشخص';
        $('pill-traffic').className = 'pill warn';
    } else {
        $('spd-down').innerHTML = '۰ <small>KB/s</small>';
        $('spd-up').innerHTML = '۰ <small>KB/s</small>';
        $('tot-down').textContent = 'مجموع: ۰';
        $('tot-up').textContent = 'مجموع: ۰';
        const pillT = $('pill-traffic');
        pillT.textContent = '—'; pillT.className = 'pill';
    }
}

function renderLogs(lines) {
    const box = $('log');
    box.innerHTML = (lines || []).map((l) => {
        const cls = /\[FATAL\]|Error|Failed/i.test(l) ? 'ln-err' : /✅/.test(l) ? 'ln-ok' : '';
        return `<div class="${cls}">${l.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>`;
    }).join('');
    box.scrollTop = box.scrollHeight;
}

async function call(url, body) {
    const opts = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined;
    const res = await fetch(url, opts);
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok && !data.error) data.error = `پاسخ ${res.status} از برنامه`;
    return data;
}

async function refresh() {
    try {
        const [mitm, eng] = await Promise.all([
            window.mahyar.mitmStatus(),
            window.mahyar.engineState(),
        ]);
        state.mitm = mitm.error ? null : mitm.data;
        state.engine = eng.error ? null : eng.data;
        render();
    } catch (e) { /* page loading */ }
}

async function act(kind, fn) {
    if (state.busy) return;
    setBusy(kind);
    try {
        const r = await fn();
        if (r.error) {
            if (kind === 'trust' || kind === 'setup') {
                $('cert-error-detail').textContent = r.error;
                $('cert-error').classList.remove('hidden');
            }
            if (r.code === 'CERT_NOT_TRUSTED') toast('گواهی نصب نیست — ابتدا نصب کنید.', true);
            else if (r.code === 'BUSY') toast(r.error, true);
            else toast('❌ ' + r.error, true);
        } else {
            if (kind === 'trust' || kind === 'setup') $('cert-error').classList.add('hidden');
            if (kind === 'setup') toast('✅ گواهی ساخته شد');
            else if (kind === 'trust') {
                if (r.data && r.data.declined) toast('نصب تأیید نشد — هر وقت خواستید دوباره بزنید.');
                else toast('✅ گواهی در ویندوز نصب شد');
            }
            else if (kind === 'remove') toast(r.data && r.data.removed ? 'گواهی حذف شد' : 'حذف گواهی کامل نشد', !(r.data && r.data.removed));
        }
        await refresh();
    } catch (e) {
        toast('❌ ' + e.message, true);
    } finally {
        clearBusy();
    }
}

async function connect() {
    if (state.busy || !ready()) return;
    state.traffic = null;
    state.lastPushAt = 0;
    setBusy('connect');
    try {
        const r = await window.mahyar.engineStart();
        if (r.error) toast('❌ ' + r.error, true);
        else toast('پروکسی محلی فعال شد');
        const logs = await window.mahyar.engineLogs();
        if (!logs.error) renderLogs(logs.data);
        await refresh();
    } catch (e) {
        toast(e.message, true);
    } finally {
        clearBusy();
    }
}

async function disconnect() {
    if (state.busy) return;
    state.traffic = null;
    state.lastPushAt = 0;
    setBusy('disconnect');
    try {
        const r = await window.mahyar.engineStop();
        if (r.error) toast(r.error, true);
        await refresh();
    } catch (e) { toast(e.message, true); }
    finally { clearBusy(); }
}

// ── event listeners ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    await refresh();
    setInterval(async () => {
        const eng = await window.mahyar.engineState();
        if (!eng.error) state.engine = eng.data;
        if (state.engine && state.engine.running) {
            const logs = await window.mahyar.engineLogs();
            if (!logs.error) renderLogs(logs.data);
        }
        render();
    }, 1500);

    window.mahyar.onState((s) => { state.engine = s; render(); });
    window.mahyar.onTraffic((t) => {
        state.traffic = t;
        state.lastPushAt = Date.now();
        render();
    });
});

// power button
$('btn-power').addEventListener('click', () => {
    if (state.busy) return;
    if (state.engine && state.engine.running) disconnect();
    else connect();
});

// action buttons
document.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
        const kind = btn.dataset.act;
        if (kind === 'setup') act('setup', () => window.mahyar.mitmSetup().then((r) => ({ ...r, declined: false })));
        else if (kind === 'trust') act('trust', () => window.mahyar.mitmTrust());
        else if (kind === 'remove' && window.confirm('گواهی محلی و کلید خصوصی حذف شوند؟ ابتدا اطمینان ویندوز به آن لغو می‌شود.')) act('remove', () => window.mahyar.mitmRemove());
        else if (kind === 'openfile') act('openfile', () => window.mahyar.mitmOpenFolder());
    });
});

// log toggle
$('btn-log-toggle').addEventListener('click', () => {
    const log = $('log');
    const btn = $('btn-log-toggle');
    log.classList.toggle('hidden');
    btn.textContent = log.classList.contains('hidden') ? 'نمایش' : 'پنهان';
    btn.setAttribute('aria-expanded', String(!log.classList.contains('hidden')));
});
$('cert-error-close').addEventListener('click', () => $('cert-error').classList.add('hidden'));

// window chrome
$('btn-min').addEventListener('click', () => window.mahyar.minimize());
$('btn-max').addEventListener('click', () => window.mahyar.toggleMaximize());
$('btn-hide').addEventListener('click', () => window.mahyar.hide());

// keyboard
document.addEventListener('keydown', (e) => {
    if (e.key === 'F11' || (e.key === 'Enter' && e.altKey)) window.mahyar.toggleMaximize();
    if (e.key === 'Escape') window.mahyar.hide();
});
