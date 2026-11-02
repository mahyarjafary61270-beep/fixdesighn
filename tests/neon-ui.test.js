'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../src/renderer/neon.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/renderer/neon.css'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');

test('Electron loads the redesigned interface and keeps the renderer bridge controls', () => {
    assert.match(main, /renderer', 'neon\.html'/);
    for (const id of ['btn-power', 'st-head', 'st-sub', 'chip-uptime', 'chip-live',
        'pill-setup', 'pill-cert', 'pill-traffic', 'cert-cn', 'cert-exp', 'cert-sha',
        'spd-down', 'spd-up', 'tot-down', 'tot-up', 'log', 'btn-log-toggle',
        'btn-min', 'btn-max', 'btn-hide', 'toast', 'step-mint', 'step-trust']) {
        assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
    }
    for (const action of ['setup', 'trust', 'remove', 'openfile']) {
        assert.match(html, new RegExp(`data-act="${action}"`));
    }
});
test('motion respects reduced-motion preference and security warning is visible', () => {
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(html, /صاحب کلید/);
    assert.match(html, /دسترسی به سایت‌ها را تضمین نمی‌کند/);
    assert.match(html, /aria-live="polite"/);
});
