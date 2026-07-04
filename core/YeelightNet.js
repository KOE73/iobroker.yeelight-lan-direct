class YeelightNet {
    constructor(host, port, opts = {}) {
        this.host = host;
        this.port = port;
        this.onLine = opts.onLine || (() => { });
        this.onStatus = opts.onStatus || (() => { });
        // Logger injected by the owner (YeelightDevice → adapter.log). Falls back to console.
        this._log = opts.log || ((msg) => console.log(msg));

        this.socket = null;
        this.buf = '';
        this.stopped = false;

        // Очередь команд
        this.queue = [];
        this.sending = false;
        this.interval = opts.interval || 200; // Пауза между командами
    }

    connect() {
        if (this.stopped) return;
        this.cleanup();

        this._log(`[YeelightNet] Connecting to ${this.host}:${this.port}...`);
        this.socket = new (require('net').Socket)();
        this.socket.setKeepAlive(true, 10000);
        this.socket.setNoDelay(true);

        this.socket.on('connect', () => {
            this._log('[YeelightNet] Connected');
            this.onStatus(1, 'Connected');
            // Drain anything that was queued while the socket was still connecting.
            this.processQueue();
        });

        this.socket.on('data', data => {
            this.buf += data.toString('utf8');
            let idx;
            while ((idx = this.buf.indexOf('\r\n')) >= 0) {
                const line = this.buf.slice(0, idx);
                this.buf = this.buf.slice(idx + 2);
                this.onLine(line);
            }
        });

        this.socket.on('error', err => {
            this._log(`[YeelightNet] Socket error: ${err.message}`, 'warn');
            this.onStatus(0, err.message);
        });

        this.socket.on('close', () => {
            this.onStatus(0, 'Disconnected');
            if (!this.stopped) setTimeout(() => this.connect(), 3000);
        });

        this.socket.connect(this.port, this.host);
    }

    /**
     * Помещает команду в очередь и запускает обработку
     */
    send(method, params, id) {
        if (this.stopped) return false;
        const line = JSON.stringify({ id, method, params }) + '\r\n';
        this.queue.push(line);
        this._log(`[YeelightNet] Pushed ${line}`);
        this.processQueue();
        return true;
    }

    async processQueue() {
        if (this.sending || this.queue.length === 0) return;
        this.sending = true;

        while (this.queue.length > 0) {
            if (!this.isReady()) break;

            const line = this.queue.shift();
            this.socket.write(line);
            this._log(`[YeelightNet] Sending ${line}`);
            // Ждем завершения интервала (throttle)
            await new Promise(res => setTimeout(res, this.interval));
        }

        this.sending = false;
    }

    isReady() {
        return !this.stopped && this.socket && !this.socket.destroyed;
    }

    cleanup() {
        if (this.socket) {
            try {
                this.socket.destroy();
            } catch (e) { }
            this.socket = null;
        }
    }

    destroy() {
        this.stopped = true;
        this.cleanup();
    }
}

if (typeof module !== 'undefined') {
    module.exports = YeelightNet;
}
