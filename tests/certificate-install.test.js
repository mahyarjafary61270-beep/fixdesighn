'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parsePrivateKey } = require('../src/main/mitm-cert');

function xrayStyleKey() {
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const pem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
    return { pair, pem: pem.replace(/PRIVATE KEY/g, 'RSA PRIVATE KEY') };
}
test('Xray-style mislabeled PKCS#8 EC key is parsed without changing its bytes', () => {
    const { pair, pem } = xrayStyleKey();
    assert.throws(() => crypto.createPrivateKey(pem));
    const key = parsePrivateKey(Buffer.from(pem));
    assert.equal(key.asymmetricKeyType, 'ec');
    assert.deepEqual(
        crypto.createPublicKey(key).export({ type: 'spki', format: 'der' }),
        pair.publicKey.export({ type: 'spki', format: 'der' })
    );
});
test('bad and encrypted key formats fail closed', () => {
    assert.throws(() => parsePrivateKey('-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----'));
    assert.throws(() => parsePrivateKey('-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----'));
});

function harness({ install = 'ok', initialTrust = false, pathApi = path } = {}) {
    const { pair, pem } = xrayStyleKey();
    const root = pathApi === path.win32 ? 'C:\\virtual\\mitm' : '/virtual/mitm';
    const certFile = pathApi.join(root, 'mahyarvpn_mitm.crt');
    const keyFile = pathApi.join(root, 'mahyarvpn_mitm.key');
    const files = {
        [certFile]: Buffer.from('test-certificate'),
        [keyFile]: Buffer.from(pem),
    };
    let trusted = initialTrust;
    let installCalls = 0;
    let optionsSeen;
    const fsMock = {
        existsSync: f => !!files[f],
        statSync: f => { if (!files[f]) throw new Error('missing'); return { size: files[f].length }; },
        readFileSync: (f, enc) => { if (!files[f]) throw new Error('missing'); return enc === 'utf8' ? files[f].toString('utf8') : files[f]; },
        writeFileSync: (f, v) => { files[f] = Buffer.from(v); },
        mkdirSync() {},
    };
    class TestCert {
        constructor() { this.ca = true; this.validTo = 'Jan 01 00:00:00 2099 GMT'; this.subject = 'CN=Test CA'; this.fingerprint256 = 'AA:BB'; this.fingerprint = 'AA:BB'; }
        checkPrivateKey(key) {
            return crypto.createPublicKey(key).export({type:'spki',format:'der'}).equals(pair.publicKey.export({type:'spki',format:'der'}));
        }
    }
    const child = { execFile(exe, args, options, callback) {
        if (exe === 'powershell.exe') return callback(null, trusted ? 'True' : 'False', '');
        if (exe === 'certutil.exe') {
            installCalls++; optionsSeen = options;
            if (install === 'ok') { trusted = true; return callback(null, 'CertUtil: completed', ''); }
            if (install === 'cancel') return callback(Object.assign(new Error('cancelled'), {code:1}), '', '0x800704c7 ERROR_CANCELLED');
            if (install === 'timeout') return callback(Object.assign(new Error('timeout'), {code:'ETIMEDOUT',killed:true}), '', '');
            return callback(Object.assign(new Error('denied'),{code:1}), '', '0x80070005 Access denied');
        }
        throw new Error('unexpected executable: ' + exe);
    }};
    const code = fs.readFileSync(path.join(__dirname, '../src/main/mitm-cert.js'), 'utf8');
    const module = { exports: {} };
    const paths = { mitmDir: () => root, ensureDataDir() {}, xrayExe: () => '/virtual/xray.exe' };
    const cryptoMock = { ...crypto, X509Certificate: TestCert };
    vm.runInNewContext(code, {module, exports:module.exports, Buffer, Date, Error, Promise,
        require: n => n === 'fs' ? fsMock : n === 'path' ? pathApi : n === 'crypto' ? cryptoMock : n === 'child_process' ? child : n === './paths' ? paths : require(n)});
    return { cert: module.exports, files, keyFile, getInstallCalls: () => installCalls, getOptions: () => optionsSeen, originalKey: pem };
}
for (const [platform, pathApi] of [['POSIX', path.posix], ['Windows', path.win32]]) {
test(`${platform}: valid existing Xray key proceeds to installation and verifies exact store status`, async () => {
    const h = harness({pathApi});
    const result = await h.cert.trust();
    assert.equal(result.trusted, true);
    assert.equal(h.getInstallCalls(), 1);
    assert.equal(h.getOptions().windowsHide, false);
    assert.equal(h.files[h.keyFile].toString(), h.originalKey);
});
test(`${platform}: already trusted certificate does not run the installer again`, async () => {
    const h = harness({initialTrust:true, pathApi});
    assert.equal((await h.cert.trust()).trusted, true);
    assert.equal(h.getInstallCalls(), 0);
});
test(`${platform}: denied and cancelled installs surface Windows output, not a false success`, async () => {
    for (const [install, code] of [['denied','0x80070005'], ['cancel','0x800704c7']]) {
        const h = harness({install, pathApi});
        await assert.rejects(h.cert.trust(), e => e.code === 'CERT_INSTALL_FAILED' && e.message.includes(code));
    }
});
test(`${platform}: installation timeout is distinct from a denial`, async () => {
    const h = harness({install:'timeout', pathApi});
    await assert.rejects(h.cert.trust(), e => e.code === 'CERT_INSTALL_TIMEOUT');
});
}
