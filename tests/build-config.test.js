'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');
const fs = require('node:fs');
const path = require('node:path');

test('CI builds do not implicitly publish to GitHub Releases', () => {
    for (const name of ['dist', 'dist:dir']) {
        assert.match(pkg.scripts[name], /(?:^|\s)--publish\s+never(?:\s|$)/);
    }
});

test('Xray release metadata uses the built-in GitHub Actions token', () => {
    const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/build-v2.yml'), 'utf8');
    const downloader = fs.readFileSync(path.join(__dirname, '../scripts/download-xray.ps1'), 'utf8');
    assert.match(workflow, /GITHUB_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
    assert.match(downloader, /\$headers\["Authorization"\]\s*=\s*"Bearer \$token"/);
});
