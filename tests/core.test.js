'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mahyar-test-'));
process.env.HOME = temp;
if (process.platform === 'win32') process.env.USERPROFILE = temp;
const paths = require('../src/main/paths');
const engine = require('../src/main/engine');
const cert = require('../src/main/mitm-cert');
after(() => fs.rmSync(temp, { recursive: true, force: true }));

test('development profile is found and user data stays outside resources', () => {
    assert.ok(fs.existsSync(paths.mitmConfigAsset()));
    assert.ok(paths.mitmDir().startsWith(temp));
    assert.ok(!paths.configPath().startsWith(paths.coreDir()));
});
test('profile replaces certificate placeholders, confines inbound listeners and adds tags', () => {
    fs.mkdirSync(cert.DIR, { recursive: true });
    fs.writeFileSync(cert.CERT, 'test fixture certificate');
    fs.writeFileSync(cert.KEY, 'test fixture key');
    const cfg = engine.buildEngineConfig();
    assert.ok(cfg);
    assert.doesNotMatch(JSON.stringify(cfg), /__(MLM|MAHYAR)_(CERT|KEY)_PATH__/);
    assert.ok(cfg.inbounds.every(i => i.listen === '127.0.0.1'));
    assert.ok(cfg.inbounds.some(i => i.tag === 'client-http' && i.port === 10809));
    assert.ok(cfg.inbounds.some(i => i.tag === 'client-socks' && i.port === 10808));
    assert.equal(cfg.routing.rules[0].inboundTag[0], 'api');
});
test('invalid existing certificate is not overwritten', async () => {
    await assert.rejects(cert.ensure(), /گواهی موجود معتبر نیست/);
    assert.equal(fs.readFileSync(cert.CERT, 'utf8'), 'test fixture certificate');
});
test('invalid or partial certificate files are not deleted accidentally', async () => {
    await assert.rejects(cert.remove(), /ناقص یا نامعتبر/);
    assert.ok(fs.existsSync(cert.CERT));
    assert.ok(fs.existsSync(cert.KEY));
});
test('traffic counts client inbound only and ignores api and duplicate outbound', () => {
    const data = [
        { name: 'inbound>>>client-http>>>traffic>>>uplink', value: '100' },
        { name: 'inbound>>>client-http>>>traffic>>>downlink', value: '200' },
        { name: 'inbound>>>api>>>traffic>>>uplink', value: '50' },
        { name: 'outbound>>>direct>>>traffic>>>uplink', value: '100' },
    ];
    assert.deepEqual(engine.sumTrafficStats(data), { up: 100, down: 200 });
});

function proxyHarness(initial) {
    const store = structuredClone(initial);
    const child = {
        execFileSync(cmd, args) {
            if (cmd === 'powershell.exe') return '';
            if (cmd !== 'reg.exe') throw new Error('unexpected process');
            const [verb, , ...rest] = args;
            const name = rest[rest.indexOf('/v') + 1];
            if (verb === 'query') {
                if (!store[name]) { const e = new Error('missing'); e.status = 1; throw e; }
                return `    ${name}    ${store[name].type}    ${store[name].value}\r\n`;
            }
            if (verb === 'delete') { delete store[name]; return ''; }
            store[name] = { type: rest[rest.indexOf('/t') + 1], value: rest[rest.indexOf('/d') + 1] };
            return '';
        }
    };
    const module = { exports: {} };
    const code = fs.readFileSync(path.join(__dirname, '../src/main/safe-proxy.js'), 'utf8');
    vm.runInNewContext(code, { module, exports: module.exports, require: n => n === 'child_process' ? child : require(n), Promise, Number, Error });
    return { proxy: module.exports, store };
}
test('proxy restores previous inactive configuration and does not touch a different owner', async () => {
    const original = { ProxyEnable: {type:'REG_DWORD',value:'0x0'}, ProxyServer:{type:'REG_SZ',value:'old:123'}, ProxyOverride:{type:'REG_SZ',value:'old-bypass'} };
    const h = proxyHarness(original);
    await h.proxy.enableSystemProxy(true, 10809);
    assert.equal(h.store.ProxyServer.value, '127.0.0.1:10809');
    await h.proxy.enableSystemProxy(false, 10809);
    assert.deepEqual(h.store, original);
    await h.proxy.enableSystemProxy(true, 10809);
    h.store.ProxyServer.value = 'new-owner:999';
    await h.proxy.enableSystemProxy(false, 10809);
    assert.equal(h.store.ProxyServer.value, 'new-owner:999');
});
test('proxy refuses to overwrite an existing enabled proxy', async () => {
    const h = proxyHarness({ ProxyEnable: { type:'REG_DWORD', value:'0x1' }, ProxyServer: { type:'REG_SZ', value:'existing:1' } });
    await assert.rejects(h.proxy.enableSystemProxy(true, 10809));
    assert.equal(h.store.ProxyServer.value, 'existing:1');
});
