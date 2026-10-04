// Фейковая лампа Yeelight: TCP-сервер с JSON-протоколом (\r\n), как у настоящей.
// Отвечает на get_prop, меняет состояние на set_*/toggle и шлёт NOTIFICATION props.
// Для тестов умеет «падать» (stop → ECONNREFUSED) и рвать текущие соединения.

const net = require('net');

class FakeLamp {
    constructor(props = {}) {
        this.props = { power: 'off', bright: '50', ct: '4000', active_mode: '0', name: '', ...props };
        this.received = [];   // все полученные команды {id, method, params}
        this.clients = new Set();
        this.server = null;
        this.port = 0;
    }

    /** Слушает порт (0 — свободный). Повторный start() поднимает тот же порт. */
    start(port = this.port) {
        return new Promise((resolve, reject) => {
            this.server = net.createServer(sock => this._onClient(sock));
            this.server.once('error', reject);
            this.server.listen(port, '127.0.0.1', () => {
                this.port = this.server.address().port;
                resolve(this.port);
            });
        });
    }

    /** Закрывает сервер и все соединения: дальше клиенты получают ECONNREFUSED. */
    stop() {
        this.dropClients();
        return new Promise(resolve => {
            if (!this.server) return resolve();
            this.server.close(() => resolve());
            this.server = null;
        });
    }

    dropClients() {
        for (const c of this.clients) c.destroy();
        this.clients.clear();
    }

    methods() {
        return this.received.map(c => c.method);
    }

    _onClient(sock) {
        this.clients.add(sock);
        sock.on('close', () => this.clients.delete(sock));
        sock.on('error', () => { });
        let buf = '';
        sock.on('data', d => {
            buf += d.toString('utf8');
            let idx;
            while ((idx = buf.indexOf('\r\n')) >= 0) {
                const line = buf.slice(0, idx);
                buf = buf.slice(idx + 2);
                this._onLine(sock, line);
            }
        });
    }

    _onLine(sock, line) {
        let cmd;
        try { cmd = JSON.parse(line); } catch (e) { return; }
        this.received.push(cmd);
        const reply = obj => sock.write(JSON.stringify(obj) + '\r\n');

        switch (cmd.method) {
            case 'get_prop':
                return reply({ id: cmd.id, result: cmd.params.map(k => this.props[k] ?? '') });
            case 'set_power':
                return this._change(sock, cmd, { power: cmd.params[0] });
            case 'toggle':
                return this._change(sock, cmd, { power: this.props.power === 'on' ? 'off' : 'on' });
            case 'set_bright':
                return this._change(sock, cmd, { bright: String(cmd.params[0]) });
            case 'set_ct_abx':
                return this._change(sock, cmd, { ct: String(cmd.params[0]) });
            case 'set_adjust': {
                // шаг настоящей лампы неизвестен — фейк берёт 10
                const [action, prop] = cmd.params;
                if (prop !== 'bright') return reply({ id: cmd.id, result: ['ok'] });
                const delta = action === 'increase' ? 10 : action === 'decrease' ? -10 : 0;
                return this._change(sock, cmd, { bright: String(clamp(Number(this.props.bright) + delta, 1, 100)) });
            }
            case 'adjust_bright':
                return this._change(sock, cmd, { bright: String(clamp(Number(this.props.bright) + cmd.params[0], 1, 100)) });
            default:
                return reply({ id: cmd.id, result: ['ok'] });
        }
    }

    _change(sock, cmd, changes) {
        Object.assign(this.props, changes);
        sock.write(JSON.stringify({ id: cmd.id, result: ['ok'] }) + '\r\n');
        const note = JSON.stringify({ method: 'props', params: changes }) + '\r\n';
        for (const c of this.clients) c.write(note);
    }
}

/** Ждёт, пока predicate() станет true (опрос каждые 5 мс). */
async function waitFor(predicate, timeoutMs = 2000, what = 'condition') {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${what}`);
        await sleep(5);
    }
}

const sleep = ms => new Promise(res => setTimeout(res, ms));
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

module.exports = { FakeLamp, waitFor, sleep };
