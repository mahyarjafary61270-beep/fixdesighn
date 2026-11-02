'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('CI builds do not implicitly publish to GitHub Releases', () => {
    for (const name of ['dist', 'dist:dir']) {
        assert.match(pkg.scripts[name], /(?:^|\s)--publish\s+never(?:\s|$)/);
    }
});
