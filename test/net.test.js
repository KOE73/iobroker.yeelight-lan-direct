const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const YeelightNet = require('../core/YeelightNet');
const { FakeLamp, waitFor, sleep } = require('./fake-lamp');

const cleanup = [];
afterEach(async () => {
    while (cleanup.length) await cleanup.pop()();
});

/** YeelightNet с короткими таймингами и записью статусов/логов. */
function makeNet(port, opts = {}) {
    const rec = { status: [], logs: [], lines: [], connects: 0 };
    const n = new YeelightNet('127.0.0.1', port, {
        interval: 5,
        retryDelay: 20,
        maxRetryDelay: 160,
        commandTtl: 200,
        onLine: line => rec.lines.push(line),
        onStatus: (status, msg, changed) => rec.status.push({ status, msg, changed }),
        log: (msg, level = 'debug') => {
            rec.logs.push({ msg, level });
            if (msg.includes('Connecting to')) rec.connects++;
        },
        ...opts,
    });
    cleanup.push(() => n.destroy());
    return { n, rec };
}

async function startLamp() {
    const lamp = new FakeLamp();
    await lamp.start();
    cleanup.push(() => lamp.stop());
    return lamp;
}

/** Порт, на котором точно никто не слушает. */
async function deadPort() {
    const lamp = new FakeLamp();
    const port = await lamp.start();
    await lamp.stop();
    return { lamp, port };
}

test('connects, reports status once and delivers commands', async () => {
    const lamp = await startLamp();
    const { n, rec } = makeNet(lamp.port);
    n.connect();
    await waitFor(() => rec.status.length === 1, 1000, 'connect');
    assert.deepEqual(rec.status[0], { status: 1, msg: 'Connected', changed: true });

    n.send('set_power', ['on', 'smooth', 300], 1);
    await waitFor(() => lamp.received.length === 1, 1000, 'command');
    assert.equal(lamp.received[0].method, 'set_power');
    await waitFor(() => rec.lines.length >= 1, 1000, 'reply');
});

test('commands sent while connecting are delivered after connect', async () => {
    const lamp = await startLamp();
    const { n } = makeNet(lamp.port);
    n.connect();
    n.send('get_prop', ['power'], 1);
    n.send('toggle', [], 2);
    await waitFor(() => lamp.received.length === 2, 1000, 'commands');
    assert.deepEqual(lamp.methods(), ['get_prop', 'toggle']);
});

test('offline lamp: one warn and one status change per outage, not per retry', async () => {
    const { port } = await deadPort();
    const { n, rec } = makeNet(port);
    n.connect();
    await waitFor(() => rec.connects >= 4, 2000, '4 attempts');

    const warns = rec.logs.filter(l => l.level === 'warn');
    assert.equal(warns.length, 1, `expected 1 warn, got: ${JSON.stringify(warns)}`);

    // error+close на одну попытку → ровно одно уведомление
    const attempts = rec.connects;
    assert.ok(rec.status.length >= attempts - 1 && rec.status.length <= attempts,
        `status calls ${rec.status.length} vs attempts ${attempts}`);
    assert.equal(rec.status.filter(s => s.changed).length, 1);
    assert.ok(rec.status.every(s => s.status === 0));
});

test('reconnect delay doubles up to maxRetryDelay', async () => {
    const { port } = await deadPort();
    const { n, rec } = makeNet(port);
    n.connect();
    await waitFor(() => rec.connects >= 6, 3000, '6 attempts');
    const delays = rec.logs
        .map(l => /Reconnect to .* in (\d+) ms/.exec(l.msg))
        .filter(Boolean)
        .map(m => Number(m[1]));
    assert.deepEqual(delays.slice(0, 5), [20, 40, 80, 160, 160]);
});

test('recovers when lamp comes back, resets backoff and warns again on next outage', async () => {
    const { lamp, port } = await deadPort();
    cleanup.push(() => lamp.stop());
    const { n, rec } = makeNet(port);
    n.connect();
    await waitFor(() => rec.connects >= 3, 2000, 'failing attempts');

    await lamp.start(port);
    await waitFor(() => rec.status.some(s => s.status === 1), 2000, 'reconnect');
    const up = rec.status.find(s => s.status === 1);
    assert.equal(up.changed, true);
    assert.equal(n._nextDelay, 20);

    // новый обрыв — снова один warn
    const warnsBefore = rec.logs.filter(l => l.level === 'warn').length;
    lamp.dropClients();
    await waitFor(() => rec.status.at(-1).status === 0, 1000, 'disconnect');
    assert.equal(rec.status.at(-1).changed, true);
    assert.equal(rec.logs.filter(l => l.level === 'warn').length, warnsBefore + 1);
    await waitFor(() => rec.status.at(-1).status === 1, 2000, 'reconnect again');
});

test('commands pressed while offline are not replayed after reconnect', async () => {
    const { lamp, port } = await deadPort();
    cleanup.push(() => lamp.stop());
    const { n, rec } = makeNet(port, { commandTtl: 100 });
    n.connect();
    await waitFor(() => rec.connects >= 1 && rec.status.length >= 1, 1000, 'first failure');

    n.send('toggle', [], 1);
    n.send('toggle', [], 2);
    n.send('toggle', [], 3);
    await sleep(150); // дольше commandTtl

    await lamp.start(port);
    await waitFor(() => rec.status.some(s => s.status === 1), 2000, 'reconnect');
    await sleep(50);
    assert.deepEqual(lamp.methods(), []);
});

test('queue is dropped on disconnect', async () => {
    const lamp = await startLamp();
    const { n, rec } = makeNet(lamp.port, { interval: 100, commandTtl: 10000 });
    n.connect();
    await waitFor(() => rec.status.length === 1, 1000, 'connect');

    for (let i = 1; i <= 5; i++) n.send('toggle', [], i);
    await waitFor(() => lamp.received.length === 1, 1000, 'first command');
    lamp.dropClients();
    await waitFor(() => rec.status.at(-1).status === 0, 1000, 'disconnect');
    await waitFor(() => rec.status.at(-1).status === 1, 2000, 'reconnect');
    await sleep(300);
    assert.equal(lamp.received.length, 1);
    assert.ok(rec.logs.some(l => /Dropped \d+ queued command/.test(l.msg)));
});

test('destroy stops reconnect attempts', async () => {
    const { port } = await deadPort();
    const { n, rec } = makeNet(port);
    n.connect();
    await waitFor(() => rec.connects >= 2, 1000, 'attempts');
    n.destroy();
    const after = rec.connects;
    await sleep(250);
    assert.equal(rec.connects, after);
    assert.equal(n.send('toggle', [], 1), false);
});
