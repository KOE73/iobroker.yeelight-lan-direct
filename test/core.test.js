const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDiscoveryText } = require('../core/YeelightCapabilities');
const { parseFlowParams, parseFlowParamsForStartCf } = require('../core/YeelightFlowParser');
const { clampInt, intToRgb, rgbToInt, normalizeBoolStrict, coerceValue } = require('../core/YeelightUtils');

// Реальный SSDP-ответ ceilc из лабы
const CEILC_SSDP = [
    'HTTP/1.1 200 OK',
    'Cache-Control: max-age=3600',
    'Location: yeelight://192.168.199.100:55443',
    'Server: POSIX UPnP/1.0 YGLC/1',
    'id: 0x000000002cedd419',
    'model: ceilc',
    'fw_ver: 5',
    'support: get_prop set_default set_power toggle set_bright set_scene cron_add cron_get cron_del start_cf stop_cf set_adjust adjust_bright set_name set_ct_abx adjust_ct bg_set_rgb bg_set_hsv bg_set_ct_abx bg_start_cf bg_stop_cf set_scene_bundle bg_set_default bg_set_power bg_set_bright bg_set_adjust bg_adjust_bright bg_adjust_color bg_adjust_ct bg_toggle dev_toggle',
    'power: on',
    'bright: 20',
    'color_mode: 2',
    'ct: 5000',
    'name: ',
    '',
].join('\r\n');

test('parseDiscoveryText: ceilc', () => {
    const info = parseDiscoveryText(CEILC_SSDP);
    assert.equal(info.ip, '192.168.199.100');
    assert.equal(info.port, 55443);
    assert.equal(info.id, '0x000000002cedd419');
    assert.equal(info.model, 'ceilc');
    assert.ok(info.support.has('adjust_bright'));
    assert.equal(info.caps.hasCT, true);
    assert.equal(info.caps.hasHSV, false);
    assert.equal(info.caps.hasAdjust, true);
    assert.equal(info.caps.hasBG, true);
    assert.equal(info.caps.hasBGToggle, true);
    assert.equal(info.caps.hasDevToggle, true);
});

test('parseDiscoveryText: headers glued with spaces (Keenetic)', () => {
    const glued = 'HTTP/1.1 200 OK Location: yeelight://10.0.0.5:55443 id: 0xabc model: color4 support: set_power set_hsv';
    const info = parseDiscoveryText(glued);
    assert.equal(info.ip, '10.0.0.5');
    assert.equal(info.id, '0xabc');
    assert.equal(info.model, 'color4');
});

test('parseFlowParams', () => {
    const p = parseFlowParams('0,0,1000,1,16711680,100,1000,1,65280,100');
    assert.equal(p.count, 0);
    assert.equal(p.steps.length, 2);
    assert.deepEqual(p.steps[1], { duration: 1000, mode: 1, value: 65280, bright: 100 });
    assert.equal(parseFlowParams(''), null);
    assert.equal(parseFlowParams('0,0,abc'), null);
});

test('parseFlowParamsForStartCf', () => {
    assert.deepEqual(parseFlowParamsForStartCf('3,1,500,2,4000,50'), { count: 3, action: 1, expr: '500,2,4000,50' });
    assert.equal(parseFlowParamsForStartCf('3,1,500,2'), null);
});

test('utils', () => {
    assert.equal(clampInt(150, 1, 100), 100);
    assert.equal(clampInt('7.6', 1, 100), 8);
    assert.equal(clampInt('x', 1, 100), null);
    assert.deepEqual(intToRgb(16744448), { r: 255, g: 128, b: 0 });
    assert.equal(rgbToInt(255, 128, 0), 16744448);
    assert.equal(normalizeBoolStrict('on'), true);
    assert.equal(normalizeBoolStrict('off'), false);
    assert.equal(normalizeBoolStrict(0), false);
    assert.equal(coerceValue('42'), 42);
    assert.equal(coerceValue('abc'), 'abc');
});
