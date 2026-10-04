const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const YeelightDevice = require('../core/YeelightDevice');
const { FakeLamp, waitFor, sleep } = require('./fake-lamp');
const { MockAdapter } = require('./mock-adapter');

const NS = 'yeelight-lan-direct.0';
const DEV_ID = '0x000000002cedd419';
const BASE = `${NS}.${DEV_ID}`;

// caps как у настоящей ceilc (из SSDP support)
const CEILC_CAPS = {
    hasCT: true, hasRGB: false, hasHSV: false, hasFlow: true, hasToggle: true, hasDevToggle: true,
    hasDefault: true, hasCron: true, hasScene: true, hasAdjust: true, hasMusic: false,
    hasBG: true, hasBGRGB: true, hasBGHSV: true, hasBGCT: true, hasBGFlow: true, hasBGToggle: true,
    hasBGDefault: true, hasBGScene: false, hasBGAdjust: true,
};

const cleanup = [];
afterEach(async () => {
    while (cleanup.length) await cleanup.pop()();
});

function makeDevice(adapter, port) {
    const dev = new YeelightDevice(adapter, {
        id: DEV_ID, ip: '127.0.0.1', port, model: 'ceilc', name: 'Люстра', caps: CEILC_CAPS,
    }, { net: { interval: 5, retryDelay: 20, maxRetryDelay: 80, commandTtl: 200 } });
    cleanup.push(() => dev.destroy());
    return dev;
}

async function startLamp(props) {
    const lamp = new FakeLamp(props);
    await lamp.start();
    cleanup.push(() => lamp.stop());
    return lamp;
}

test('connect: _connected is boolean, device has statusStates.onlineId', async () => {
    const lamp = await startLamp();
    const a = new MockAdapter(NS);
    makeDevice(a, lamp.port);
    await waitFor(() => a.val(`${BASE}._connected`) === true, 1000, '_connected');

    const c = a.common(`${BASE}._connected`);
    assert.equal(c.type, 'boolean');
    assert.equal(c.role, 'indicator.connected');
    assert.equal(c.write, false);
    await waitFor(() => a.common(BASE)?.statusStates, 1000, 'statusStates');
    assert.deepEqual(a.common(BASE).statusStates, { onlineId: `${BASE}._connected` });
    assert.equal(a.common(BASE).name, 'Люстра');
    assert.equal(a.connection['127.0.0.1'], true);
});

test('legacy number _connected object is migrated to boolean, user name kept', async () => {
    const lamp = await startLamp();
    const a = new MockAdapter(NS);
    a.objects.set(BASE, { _id: BASE, type: 'device', common: { name: 'Моя люстра' }, native: {} });
    a.objects.set(`${BASE}._connected`, {
        _id: `${BASE}._connected`, type: 'state',
        common: { name: 'connected', type: 'number', role: 'indicator.connected', read: true, write: false },
        native: {},
    });
    makeDevice(a, lamp.port);
    await waitFor(() => a.val(`${BASE}._connected`) === true, 1000, '_connected');
    await waitFor(() => a.common(BASE)?.statusStates, 1000, 'statusStates');
    assert.equal(a.common(`${BASE}._connected`).type, 'boolean');
    assert.equal(a.common(BASE).name, 'Моя люстра');
});

test('get_prop result → states with roles, ranges and write flags', async () => {
    const lamp = await startLamp({ power: 'on', bright: '53', ct: '4000', bg_power: 'on', bg_bright: '100' });
    const a = new MockAdapter(NS);
    makeDevice(a, lamp.port);
    await waitFor(() => a.val(`${BASE}.bright`) === 53, 1000, 'bright');

    assert.equal(a.val(`${BASE}.power`), true);
    assert.deepEqual(
        pick(a.common(`${BASE}.power`), ['type', 'role', 'write']),
        { type: 'boolean', role: 'switch.light', write: true });
    assert.deepEqual(
        pick(a.common(`${BASE}.bright`), ['type', 'role', 'min', 'max', 'unit', 'write']),
        { type: 'number', role: 'level.dimmer', min: 1, max: 100, unit: '%', write: true });
    assert.deepEqual(
        pick(a.common(`${BASE}.ct`), ['role', 'min', 'max', 'unit']),
        { role: 'level.color.temperature', min: 2700, max: 6500, unit: 'K' });
    // фон — на общих ролях, чтобы type-detector не путал с основным светом
    assert.equal(a.common(`${BASE}.bg_power`).role, 'switch');
    // read-only свойство лампы
    await waitFor(() => a.common(`${BASE}.bg_lmode`), 1000, 'bg_lmode');
    assert.equal(a.common(`${BASE}.bg_lmode`).write, false);
});

test('existing objects with old roles are updated once, then cached', async () => {
    const lamp = await startLamp({ power: 'on', bright: '50' });
    const a = new MockAdapter(NS);
    a.objects.set(`${BASE}.bright`, {
        _id: `${BASE}.bright`, type: 'state',
        common: { name: 'bright', type: 'number', role: 'level.dimmer', read: true, write: true },
        native: {},
    });
    const dev = makeDevice(a, lamp.port);
    await waitFor(() => a.val(`${BASE}.bright`) === 50, 1000, 'bright');
    assert.equal(a.common(`${BASE}.bright`).unit, '%');

    // первая команда создаёт служебные _last_* — их чтение законно
    dev.sendYeelight('set_bright', [5, 'smooth', 300]);
    await waitFor(() => a.val(`${BASE}.bright`) === 5, 1000, 'bright 5');
    await sleep(20);

    const gets = a.calls.getObject;
    // много изменений яркости → ни одного нового чтения объектов
    for (const b of [10, 20, 30, 40]) dev.sendYeelight('set_bright', [b, 'smooth', 300]);
    await waitFor(() => a.val(`${BASE}.bright`) === 40, 1000, 'bright 40');
    assert.equal(a.calls.getObject, gets);
});

test('offline lamp: info log once per outage, retries go to debug', async () => {
    const lamp = new FakeLamp();
    const port = await lamp.start();
    await lamp.stop();
    const a = new MockAdapter(NS);
    makeDevice(a, port);
    await waitFor(() => a.logs.filter(l => /Connecting to/.test(l.msg)).length >= 4, 2000, 'retries');

    assert.equal(a.logsAt('info', /Disconnected/).length, 1);
    assert.equal(a.logsAt('warn').length, 1);
    assert.equal(a.val(`${BASE}._connected`), false);
});

test('button TOGGLE goes to the lamp', async () => {
    const lamp = await startLamp({ power: 'off' });
    const a = new MockAdapter(NS);
    const dev = makeDevice(a, lamp.port);
    await waitFor(() => a.val(`${BASE}._connected`) === true, 1000, 'connect');

    await dev.TX_MAP.TOGGLE.jsMethod();
    await waitFor(() => a.val(`${BASE}.power`) === true, 1000, 'power on');
    assert.ok(lamp.methods().includes('toggle'));
});

test('BRIGHT_UP steps from current value', async () => {
    const lamp = await startLamp({ bright: '50' });
    const a = new MockAdapter(NS);
    const dev = makeDevice(a, lamp.port);
    await waitFor(() => a.val(`${BASE}.bright`) === 50, 1000, 'bright');
    await dev.TX_MAP.BRIGHT_UP.jsMethod();
    await waitFor(() => a.val(`${BASE}.bright`) === 60, 1000, 'bright 60');
    await sleep(10);
});

test('BRIGHT_INC/DEC send native set_adjust', async () => {
    const lamp = await startLamp({ bright: '50' });
    const a = new MockAdapter(NS);
    const dev = makeDevice(a, lamp.port);
    await waitFor(() => a.val(`${BASE}.bright`) === 50, 1000, 'bright');

    await dev.TX_MAP.BRIGHT_INC.jsMethod();
    await waitFor(() => a.val(`${BASE}.bright`) === 60, 1000, 'bright 60');
    await dev.TX_MAP.BRIGHT_DEC.jsMethod();
    await waitFor(() => a.val(`${BASE}.bright`) === 50, 1000, 'bright 50');

    const adj = lamp.received.filter(c => c.method === 'set_adjust').map(c => c.params);
    assert.deepEqual(adj, [['increase', 'bright'], ['decrease', 'bright']]);
    assert.ok(dev.TX_MAP.CT_INC && dev.TX_MAP.BG_BRIGHT_INC);
    assert.equal(a.common(`${BASE}.BRIGHT_INC`).role, 'button');
});

test('adjust_bright object exists and sends a percentage delta', async () => {
    const lamp = await startLamp({ bright: '50' });
    const a = new MockAdapter(NS);
    const dev = makeDevice(a, lamp.port);
    await waitFor(() => a.val(`${BASE}.bright`) === 50, 1000, 'bright');

    await waitFor(() => a.common(`${BASE}.adjust_bright`), 1000, 'adjust_bright object');
    assert.deepEqual(
        pick(a.common(`${BASE}.adjust_bright`), ['type', 'min', 'max', 'unit', 'write']),
        { type: 'number', min: -100, max: 100, unit: '%', write: true });
    // ceilc без RGB/HSV — adjust_color не нужен
    assert.equal(dev.TX_MAP.adjust_color, undefined);
    await sleep(20);
    assert.equal(a.common(`${BASE}.adjust_color`), undefined);

    const cmd = await dev.TX_MAP.adjust_bright(30);
    dev.sendYeelight(cmd.method, cmd.params);
    await waitFor(() => a.val(`${BASE}.bright`) === 80, 1000, 'bright 80');
});

function pick(obj, keys) {
    return Object.fromEntries(keys.map(k => [k, obj?.[k]]));
}
