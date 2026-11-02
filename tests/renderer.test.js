'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
function setup() {
    const elements = {};
    function el(id) {
        if (!elements[id]) {
            const classes = new Set();
            elements[id] = { dataset:{}, disabled:false, textContent:'', innerHTML:'', className:'',
                classList:{ add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x), toggle: (x,v) => v === undefined ? (classes.has(x) ? classes.delete(x) : classes.add(x)) : (v ? classes.add(x) : classes.delete(x)) },
                addEventListener(name, cb) { this[name] = cb; } };
        }
        return elements[id];
    }
    const actions = ['setup','trust','remove','openfile'].map(a => { const v=el(a); v.dataset.act=a; return v; });
    const doc = { getElementById: el, querySelector(s) {
        if (s === '.hero') return el('hero');
        if (s === '#step-mint .step-dot') return el('mintDot');
        if (s === '#step-trust .step-dot') return el('trustDot');
        const match = s.match(/^\[data-act="(.+)"\]$/);
        if (match) return el(match[1]);
        throw new Error(s);
    }, querySelectorAll: () => actions, addEventListener() {} };
    let starts = 0;
    const api = {
        engineStart: async () => { starts++; return { ok:true, data:{ok:true} }; },
        engineStop: async () => ({ok:true}), engineLogs: async () => ({ok:true,data:[]}),
        engineState: async () => ({ok:true,data:{running:true,uptime:10}}),
        mitmStatus: async () => ({ok:true,data:{exists:true,trusted:true,cert:null}}),
        minimize(){}, toggleMaximize(){}, hide(){}
    };
    const ctx = vm.createContext({ document:doc, window:{mahyar:api,confirm:()=>true}, console,
        setTimeout:()=>0, clearTimeout:()=>{}, setInterval:()=>0, Date });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'),'utf8'),ctx);
    return { ctx, elements, starts:()=>starts };
}
test('power path starts after trusted setup and clears busy on success', async () => {
    const h=setup();
    vm.runInContext('state.mitm={exists:true,trusted:true}; state.engine={running:false}; render()',h.ctx);
    assert.equal(h.elements['btn-power'].disabled,false);
    await vm.runInContext('connect()',h.ctx);
    assert.equal(h.starts(),1);
    assert.equal(vm.runInContext('state.busy',h.ctx),null);
    assert.equal(h.elements['st-head'].textContent,'پروکسی فعال است');
    assert.equal(h.elements['pill-traffic'].textContent,'نامشخص');
});
test('power stays disabled until certificate is trusted', () => {
    const h=setup();
    vm.runInContext('state.mitm={exists:true,trusted:false}; render()',h.ctx);
    assert.equal(h.elements['btn-power'].disabled,true);
    assert.equal(vm.runInContext('ready()',h.ctx),false);
});
test('certificate install errors remain visible with full details', async () => {
    const h = setup();
    await vm.runInContext(`act('trust', async () => ({ok:false,code:'CERT_INSTALL_FAILED',error:'CertUtil 0x80070005 Access denied'}))`, h.ctx);
    assert.equal(h.elements['cert-error-detail'].textContent, 'CertUtil 0x80070005 Access denied');
    assert.equal(h.elements['cert-error'].classList.contains('hidden'), false);
    assert.equal(vm.runInContext('state.busy', h.ctx), null);
});
