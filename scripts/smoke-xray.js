'use strict';
// Windows CI integration check: actually generate a throwaway CA and validate the
// app-generated profile with the downloaded Xray and bundled geodata. No trust install.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mahyar-smoke-'));
process.env.USERPROFILE = tmp;
process.env.HOME = tmp;
const paths = require('../src/main/paths');
const cert = require('../src/main/mitm-cert');
const engine = require('../src/main/engine');
(async () => {
    try {
        await cert.ensure();
        // Existing keys are read again when the user presses Install. Catch PEM
        // label/format incompatibilities before packaging on Windows.
        await cert.ensure();
        const config = engine.buildEngineConfig();
        if (!config) throw new Error('Failed to build engine config');
        const file = path.join(tmp, 'test.json');
        fs.writeFileSync(file, JSON.stringify(config));
        const result = spawnSync(paths.xrayExe(), ['run', '-test', '-config', file], {
            encoding: 'utf8', cwd: paths.coreDir(), env: { ...process.env, XRAY_LOCATION_ASSET: paths.coreDir() }
        });
        process.stdout.write(result.stdout || '');
        process.stderr.write(result.stderr || '');
        if (result.error || result.status !== 0) throw result.error || new Error('Xray configuration test failed');
        console.log('Xray configuration and geodata passed.');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
})().catch((error) => { console.error(error); process.exitCode = 1; });
