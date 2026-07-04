// YeelightDetect.js
// Discovers Yeelight devices on the local network via SSDP multicast.
// Returns structured device info including parsed capability flags.

const dgram = require('dgram');

function yeelightDiscover(timeoutMs = 3000, options = {}) {
    return new Promise((resolve, reject) => {
        const sock = dgram.createSocket('udp4');
        // Logger injected by the caller (main.js → adapter.log); falls back to console.
        const _log = (options && typeof options.log === 'function') ? options.log : console.log;

        const msg =
            'M-SEARCH * HTTP/1.1\r\n' +
            'HOST: 239.255.255.250:1982\r\n' +
            'MAN: "ssdp:discover"\r\n' +
            'ST: wifi_bulb\r\n' +
            '\r\n';

        const results = [];

        // Cache the parser
        let parser;
        try {
            parser = typeof parseDiscoveryText === 'function'
                ? parseDiscoveryText
                : require('./YeelightCapabilities.js').parseDiscoveryText;
        } catch (e) {
            _log(`[YeelightDetect] Could not load parser: ${e.message}`, 'warn');
        }

        sock.on('error', (err) => {
            _log(`[YeelightDetect] Socket error: ${err.message}`, 'error');
            sock.close();
            reject(err);
        });

        sock.on('message', (buf, rinfo) => {
            const text = buf.toString('utf8');
            _log(`\n[YeelightDetect] === RAW GUTS FROM ${rinfo.address}:${rinfo.port} ===\n${text}\n==============================================`);
            
            try {
                if (parser) {
                    const info = parser(text);
                    if (info && info.ip && info.id) {
                        const isDuplicate = results.some(r => r.id === info.id);
                        if (!isDuplicate) {
                            _log(`[YeelightDetect] Found Device: ${info.ip} (id: ${info.id}, model: ${info.model})`);
                            results.push(info);
                        }
                    } else {
                        _log(`[YeelightDetect] Parser failed to extract mandatory fields (IP/ID) from message.`);
                    }
                }
            } catch (e) {
                _log(`[YeelightDetect] Internal Parse Error: ${e.message}`, 'warn');
            }
        });

        const interfaceAddress = options && typeof options.interfaceAddress === 'string'
            ? options.interfaceAddress.trim()
            : '';
        const targetAddress = options && typeof options.targetAddress === 'string' && options.targetAddress.trim()
            ? options.targetAddress.trim()
            : '239.255.255.250';

        const onSocketBound = () => {
            _log(`[YeelightDetect] Socket bound, sending M-SEARCH to ${targetAddress}${interfaceAddress ? ` via ${interfaceAddress}` : ''}...`);
            try {
                sock.setBroadcast(true);
                if (interfaceAddress) {
                    sock.setMulticastInterface(interfaceAddress);
                }
                sock.setMulticastTTL(128);
                sock.send(Buffer.from(msg, 'utf8'), 1982, targetAddress, (err) => {
                    if (err) _log(`[YeelightDetect] Send error: ${err.message}`, 'error');
                    else _log(`[YeelightDetect] M-SEARCH packet sent.`);
                });
            } catch (e) {
                _log(`[YeelightDetect] Error during setup: ${e.message}`, 'error');
            }
        };

        if (interfaceAddress) {
            sock.bind({ address: interfaceAddress, port: 0 }, onSocketBound);
        } else {
            sock.bind(onSocketBound);
        }

        setTimeout(() => {
            _log(`[YeelightDetect] Discovery timeout reached. Total found: ${results.length}`);
            sock.close();
            resolve(results);
        }, timeoutMs);
    });
}

// ─── Standalone run (ioBroker compat) ────────────────────────────────────────
if (typeof module === 'undefined' || require.main === module) {
    yeelightDiscover().then(res => {
        const _log = (typeof global !== 'undefined' && typeof global.log === 'function') ? global.log : console.log;
        _log(`[Yeelight DISCOVERY] responses=${res.length}`, 'info');
        res.forEach(r => {
            if (r.model) {
                _log(`[Yeelight DISCOVERY] ${r.ip}:${r.port}  model=${r.model}  id=${r.id}  name="${r.name}"`, 'info');
                _log(`[Yeelight DISCOVERY] caps: ${JSON.stringify(r.caps)}`, 'info');
            } else {
                _log(`[Yeelight DISCOVERY] ${r.from}\n${r.text}`, 'info');
            }
        });
    });
}

if (typeof module !== 'undefined') {
    module.exports = { yeelightDiscover };
}
