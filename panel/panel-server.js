/**
 * panel-server.js — Yeelight visual debug panel
 * Standalone entry point (replaces debug.js for UI mode).
 *
 * Flow:
 *  1. Load mocks + global helpers
 *  2. Run SSDP discovery (2 sec)
 *  3. Store discovered device info in global.discoveredDevices
 *  4. Start HTTP + SSE server
 *  5. Load Run.js — YeelightDevice reads caps from discoveredDevices
 *  6. Launch isolated Chrome window
 */

require('../debug/mock-iobroker.js');

// Load global helpers (same order as debug.js)
Object.assign(global, require('../core/YeelightUtils.js'));
Object.assign(global, require('../core/YeelightFlowParser.js'));
Object.assign(global, require('../core/YeelightCapabilities.js'));  // parseDiscoveryText, buildCaps, buildProfile
global.buildTxMap = require('../core/YeelightCommands.js').buildTxMap;
global.YeelightNet = require('../core/YeelightNet.js');

const { yeelightDiscover } = require('../core/YeelightDetect.js');
const { buildProfile } = require('../core/YeelightCapabilities.js');

// --- Capture device instances ---
const devices = {};
global.YeelightDevice = class extends require('../core/YeelightDevice.js') {
    constructor(host, baseName, port) {
        super(host, baseName, port);
        const name = baseName.split('.').pop();
        devices[name] = this;
        log(`[Panel] registered device: ${name}  model=${this.model || '?'}`);
    }
};

// --- SSE broadcast ---
const sseClients = [];
function broadcast(data) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(r => { try { r.write(msg); } catch (e) { } });
}

// Patch setState to emit SSE events on every state change
const _origSetState = global.setState;
global.setState = (id, val, ack, cb) => {
    _origSetState(id, val, ack, cb);
    broadcast({ type: 'state', id, val });
};

// --- HTTP server ---
const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // SSE stream
    if (url.pathname === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
        });
        sseClients.push(res);
        // Build dynamic profiles from discovered caps
        const profiles = buildDynamicProfiles();
        res.write(`data: ${JSON.stringify({ type: 'init', states: global.states, profiles })}\n\n`);
        req.on('close', () => sseClients.splice(sseClients.indexOf(res), 1));
        return;
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
    }

    // Command endpoint: { device, action, params }
    if (url.pathname === '/cmd' && req.method === 'POST') {
        let body = '';
        req.on('data', d => body += d);
        req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            try {
                const { device, action, params = [] } = JSON.parse(body);
                const dev = devices[device];
                if (!dev) return res.end(JSON.stringify({ ok: false, error: 'device not found' }));
                if (typeof dev[action] !== 'function') return res.end(JSON.stringify({ ok: false, error: `no method: ${action}` }));
                dev[action](...params);
                res.end(JSON.stringify({ ok: true }));
            } catch (e) {
                res.end(JSON.stringify({ ok: false, error: e.message }));
            }
        });
        return;
    }

    // Serve panel.html
    if (url.pathname === '/' || url.pathname === '/panel.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8'));
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

// Build per-device profiles from their caps (falls back to device-profiles.js)
function buildDynamicProfiles() {
    const staticProfiles = (() => {
        try { return require('./device-profiles.js'); } catch (e) { return {}; }
    })();

    const result = {};
    Object.entries(devices).forEach(([name, dev]) => {
        result[name] = buildProfile(dev.caps)          // auto from discovery
            || staticProfiles[name]             // manual override
            || staticProfiles.__default__       // fallback
            || null;
    });
    return result;
}

// --- Auto-launch Chrome ---
const { launchChrome } = require('../debug/browser-utils.js');


// --- Main startup sequence ---
log('[Panel] Starting SSDP discovery (2 sec)...');

yeelightDiscover(2000).then(discovered => {
    global.discoveredDevices = {};
    discovered.forEach(d => {
        if (d.ip) {
            global.discoveredDevices[d.ip] = d;
            log(`[Panel] Discovered: ${d.ip}  model=${d.model}  caps=${JSON.stringify(d.caps)}`);
        }
    });

    // Start HTTP server after discovery
    server.listen(3000, () => {
        log('[Panel] 🚀  http://localhost:3000');
        launchChrome('http://localhost:3000');
    });

    // Load devices from Run.js (they will use global.discoveredDevices for caps)
    require('../core/Run.js');

}).catch(err => {
    log(`[Panel] Discovery error: ${err.message}`, 'warn');
    server.listen(3000, () => {
        log('[Panel] 🚀  http://localhost:3000 (no discovery)');
        launchChrome('http://localhost:3000');
    });
    require('../core/Run.js');
});

setInterval(() => { }, 10000);
onStop(() => { }, 2000);
