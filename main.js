const utils = require("@iobroker/adapter-core");
const dgram = require('dgram');
const os = require('os');
const YeelightDevice = require("./core/YeelightDevice");
const { yeelightDiscover } = require("./core/YeelightDetect");
const { parseDiscoveryText } = require("./core/YeelightCapabilities");

class YeelightV2 extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: "yeelight-lan-direct",
        });
        this.on("ready", this.onReady.bind(this));
        this.on("stateChange", this.onStateChange.bind(this));
        this.on("message", this.onMessage.bind(this));
        this.on("unload", this.onUnload.bind(this));

        this.instances = {};   // host(ip) -> YeelightDevice
        this._connState = {};  // host(ip) -> bool, aggregated into info.connection
        this.discoverySocket = null;
    }

    async onReady() {
        this.log.info("Starting Yeelight LAN Direct Control (TCP/JSON-RPC)");

        // Standard connection indicator starts red until a lamp connects.
        this._connState = {};
        await this.setStateAsync('info.connection', false, true);

        const devices = this.config.devices || [];
        for (const dev of devices) {
            if (dev.ip && dev.enabled) this._initDevice(dev);
        }

        // Background SSDP listener to track IP changes (NOTIFY) by device id.
        this._setupDiscoveryListener();

        this.subscribeStates("*");
    }

    _initDevice(dev) {
        const host = dev.ip;
        if (this.instances[host]) {
            this.log.debug(`Device ${host} already initialized.`);
            return;
        }
        this.log.info(`Initializing device: ${dev.name || dev.model || host} (${host})`);
        try {
            this.instances[host] = new YeelightDevice(this, dev);
        } catch (e) {
            this.log.error(`Failed to init device ${host}: ${e.message}`);
        }
    }

    /** Called by YeelightDevice when a lamp connects/disconnects. */
    reportDeviceConnection(host, connected) {
        this._connState[host] = connected;
        const anyConnected = Object.values(this._connState).some(Boolean);
        this.setState('info.connection', anyConnected, true);
    }

    /**
     * Listen on UDP 1982 in the background. If a known lamp (same id) reappears on a
     * new IP, reconnect it there. Object ids are id-based, so the tree is preserved.
     */
    _setupDiscoveryListener() {
        try {
            this.discoverySocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

            this.discoverySocket.on('message', (buf) => {
                const info = parseDiscoveryText(buf.toString('utf8'));
                if (!info || !info.id || !info.ip) return;

                for (const host of Object.keys(this.instances)) {
                    const inst = this.instances[host];
                    if (inst.ID === info.id && host !== info.ip) {
                        this.log.info(`Device ${info.id} changed IP from ${host} to ${info.ip}. Reconnecting...`);
                        inst.destroy();
                        delete this.instances[host];
                        delete this._connState[host];
                        this._initDevice(info);
                        break;
                    }
                }
            });

            this.discoverySocket.on('error', (err) => {
                this.log.error(`Discovery Listener Error: ${err.message}`);
            });

            this.discoverySocket.bind(1982, () => {
                try {
                    this.discoverySocket.addMembership('239.255.255.250');
                    this.log.info("Background SSDP listener started on port 1982");
                } catch (e) {
                    this.log.warn("Could not join multicast group. NOTIFY packets might be missed.");
                }
            });
        } catch (e) {
            this.log.error(`Failed to setup discovery listener: ${e.message}`);
        }
    }

    onUnload(callback) {
        try {
            if (this.discoverySocket) this.discoverySocket.close();
            this.setState('info.connection', false, true);
            Object.values(this.instances).forEach(dev => dev.destroy());
            this.log.info("Yeelight LAN Direct cleaned up.");
            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Standard command routing: external writes (ack === false) to a device state
     * are translated to Yeelight commands via the device TX_MAP.
     */
    async onStateChange(id, state) {
        if (!state || state.ack) return;

        const inst = Object.values(this.instances).find(d => id.startsWith(d.BASE + '.'));
        if (!inst) return;

        const key = id.slice(inst.BASE.length + 1);
        const builder = inst.TX_MAP[key];
        if (!builder) return;

        try {
            if (builder.isButton) {
                if (state.val === true) {
                    try { builder.jsMethod && await builder.jsMethod(); }
                    finally { this.setState(id, false, true); }
                }
                return;
            }
            const cmd = await builder(state.val);
            if (!cmd) return;
            if (cmd.method) inst.sendYeelight(cmd.method, cmd.params);
            else if (cmd.jsMethod) await cmd.jsMethod();
        } catch (e) {
            this.log.warn(`Command "${key}" failed: ${e.message}`);
        }
    }

    async onMessage(obj) {
        if (!obj || !obj.command) return;

        if (obj.command === "listInterfaces") {
            if (obj.callback) this.sendTo(obj.from, obj.command, this._listNetworkInterfaces(), obj.callback);
            return;
        }

        if (obj.command === "control") {
            try {
                const result = await this._controlDevice(obj.message || {});
                if (obj.callback) this.sendTo(obj.from, obj.command, result, obj.callback);
            } catch (e) {
                this.log.error(`Control error: ${e.message}`);
                if (obj.callback) this.sendTo(obj.from, obj.command, { ok: false, error: e.message }, obj.callback);
            }
            return;
        }

        if (obj.command === "discover") {
            this.log.info("Starting discovery via Admin request...");
            try {
                const payload = obj.message || {};
                const found = await this._discoverDevices(payload);
                this.log.info(`Discovery finished. Found ${found.length} devices.`);

                // JSON-Config sendTo with useNative: merge found lamps into the saved
                // device list and return native.devices so Admin updates the table.
                const current = Array.isArray(payload.devices) ? payload.devices : (this.config.devices || []);
                const merged = this._mergeFoundDevices(current, found);
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, { native: { devices: merged }, result: 'found', found: found.length }, obj.callback);
                }
            } catch (e) {
                this.log.error(`Discovery error: ${e.message}`);
                if (obj.callback) this.sendTo(obj.from, obj.command, [], obj.callback);
            }
        }
    }

    _listNetworkInterfaces() {
        const result = [];
        const nets = os.networkInterfaces();
        Object.keys(nets).forEach(name => {
            (nets[name] || []).forEach(addr => {
                if (addr.family !== 'IPv4' || addr.internal) return;
                result.push({ name, address: addr.address, netmask: addr.netmask, mac: addr.mac, label: `${name} (${addr.address})` });
            });
        });
        return result;
    }

    /** Merge freshly discovered lamps into the existing device list (match by id, then ip). */
    _mergeFoundDevices(current, found) {
        const devices = current.map(d => ({
            enabled: d.enabled !== false,
            id: d.id || '',
            ip: d.ip || '',
            port: Number(d.port || 55443),
            model: d.model || '',
            name: d.name || '',
            caps: (d.caps && typeof d.caps === 'object') ? d.caps : null,
        }));

        (found || []).forEach(f => {
            if (!f || (!f.id && !f.ip)) return;
            const existing = devices.find(d => (f.id && d.id === f.id) || (f.ip && d.ip === f.ip));
            if (existing) {
                existing.ip = f.ip || existing.ip;
                existing.id = f.id || existing.id;
                existing.model = f.model || existing.model;
                existing.name = existing.name || f.name || '';
                existing.port = Number(f.port || existing.port || 55443);
                if (f.caps && typeof f.caps === 'object') existing.caps = f.caps;
                return;
            }
            devices.push({
                enabled: true,
                id: f.id || '',
                ip: f.ip || '',
                port: Number(f.port || 55443),
                model: f.model || 'unknown',
                name: f.name || 'Yeelight',
                caps: (f.caps && typeof f.caps === 'object') ? f.caps : null,
            });
        });

        return devices;
    }

    async _discoverDevices(payload) {
        const timeout = Number(payload.timeoutMs) || 4000;
        const mode = payload.mode || 'auto';
        const targetAddress = typeof payload.targetAddress === 'string' ? payload.targetAddress.trim() : '';
        const interfaceAddress = typeof payload.interfaceAddress === 'string' ? payload.interfaceAddress.trim() : '';

        // Verbose SSDP chatter → debug; explicit warn/error preserved.
        const log = (msg, level) => {
            if (level === 'error') this.log.error(msg);
            else if (level === 'warn') this.log.warn(msg);
            else this.log.debug(msg);
        };

        if (mode === 'manual' && targetAddress) {
            return await yeelightDiscover(timeout, { targetAddress, interfaceAddress, log });
        }
        if (mode === 'interface' && interfaceAddress) {
            return await yeelightDiscover(timeout, { interfaceAddress, log });
        }
        if (mode === 'all') {
            const merged = new Map();
            const interfaces = this._listNetworkInterfaces();
            const attempts = [{}].concat(interfaces.map(item => ({ interfaceAddress: item.address })));
            for (const options of attempts) {
                try {
                    const found = await yeelightDiscover(timeout, { ...options, log });
                    found.forEach(item => merged.set(item.id || item.ip, item));
                } catch (e) {
                    this.log.warn(`Discovery attempt failed${options.interfaceAddress ? ` on ${options.interfaceAddress}` : ''}: ${e.message}`);
                }
            }
            return Array.from(merged.values());
        }
        return await yeelightDiscover(timeout, { log });
    }

    /** sendTo('control') entry point (used by an in-admin remote). */
    async _controlDevice(payload) {
        const device = payload.device || {};
        const state = payload.state;
        const value = payload.value;
        if (!device.ip) throw new Error('Device IP is required');
        if (!state) throw new Error('State/command is required');

        let instance = this.instances[device.ip];
        if (!instance) {
            this.log.info(`Initializing temporary control target: ${device.name || device.ip} (${device.ip})`);
            this._initDevice(device);
            instance = this.instances[device.ip];
        }
        if (!instance) throw new Error(`Device instance not available for ${device.ip}`);

        const builder = instance.TX_MAP[state];
        if (!builder) throw new Error(`Unsupported command/state: ${state}`);

        if (builder.isButton) {
            if (builder.jsMethod) await builder.jsMethod();
            return { ok: true, command: state };
        }

        const command = await builder(value);
        if (!command) return { ok: true, command: state, skipped: true };
        if (command.method) instance.sendYeelight(command.method, command.params);
        else if (command.jsMethod) await command.jsMethod();
        return { ok: true, command: state };
    }
}

if (require.main !== module) {
    module.exports = (options) => new YeelightV2(options);
} else {
    new YeelightV2();
}
