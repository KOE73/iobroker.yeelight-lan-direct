const net = (typeof require === 'function') ? require('net') : null;

class YeelightNet {
    /**
     * @param {string} host
     * @param {number} port
     * @param {object} opts
     *   onLine(line), onStatus(status, msg, changed), log(msg, level),
     *   interval       — пауза между командами, мс (throttle);
     *   retryDelay     — первая пауза перед переподключением, мс;
     *   maxRetryDelay  — потолок паузы (пауза удваивается при каждой неудаче);
     *   commandTtl     — сколько команда может ждать в очереди, мс. Команды старше
     *                    отбрасываются, чтобы нажатия во время офлайна не выполнились
     *                    пачкой после переподключения.
     */
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

        this.retryDelay = opts.retryDelay ?? 3000;
        this.maxRetryDelay = opts.maxRetryDelay ?? 60000;
        this._nextDelay = this.retryDelay;
        this._retryTimer = null;
        this._failures = 0;   // неудачных попыток подряд (сбрасывается при connect)
        this._status = null;  // последний отправленный onStatus: 1 / 0 / null

        // Очередь команд
        this.queue = [];
        this.sending = false;
        this.interval = opts.interval || 200; // Пауза между командами
        this.commandTtl = opts.commandTtl ?? 5000;
    }

    connect() {
        if (this.stopped) return;
        this._clearRetryTimer();
        this.cleanup();

        this._log(`[YeelightNet] Connecting to ${this.host}:${this.port}...`);
        const socket = new net.Socket();
        this.socket = socket;
        let failed = false; // error и close на один обрыв → одно уведомление
        socket.setKeepAlive(true, 10000);
        socket.setNoDelay(true);

        socket.on('connect', () => {
            this._log('[YeelightNet] Connected');
            this._failures = 0;
            this._nextDelay = this.retryDelay;
            this._setStatus(1, 'Connected');
            // Drain anything that was queued while the socket was still connecting.
            this.processQueue();
        });

        socket.on('data', data => {
            this.buf += data.toString('utf8');
            let idx;
            while ((idx = this.buf.indexOf('\r\n')) >= 0) {
                const line = this.buf.slice(0, idx);
                this.buf = this.buf.slice(idx + 2);
                this.onLine(line);
            }
        });

        socket.on('error', err => {
            if (this.socket !== socket) return;
            failed = true;
            this._onDown(err.message);
        });

        socket.on('close', () => {
            if (this.socket !== socket) return; // сокет уже заменён или закрыт через cleanup()
            this.socket = null;
            if (!failed) this._onDown('Disconnected');
            this._scheduleReconnect();
        });

        socket.connect(this.port, this.host);
    }

    /** Обрыв или неудачная попытка: один warn на серию, дальше — debug. */
    _onDown(msg) {
        this._failures++;
        const level = this._failures === 1 ? 'warn' : 'debug';
        this._log(`[YeelightNet] ${this.host}:${this.port} ${msg}`, level);
        this._dropQueue('disconnected');
        this._setStatus(0, msg);
    }

    _setStatus(status, msg) {
        const changed = status !== this._status;
        this._status = status;
        this.onStatus(status, msg, changed);
    }

    _scheduleReconnect() {
        if (this.stopped || this._retryTimer) return;
        const delay = this._nextDelay;
        this._nextDelay = Math.min(this._nextDelay * 2, this.maxRetryDelay);
        this._log(`[YeelightNet] Reconnect to ${this.host} in ${delay} ms`);
        this._retryTimer = setTimeout(() => {
            this._retryTimer = null;
            this.connect();
        }, delay);
    }

    _clearRetryTimer() {
        if (this._retryTimer) {
            clearTimeout(this._retryTimer);
            this._retryTimer = null;
        }
    }

    _dropQueue(reason) {
        if (this.queue.length === 0) return;
        this._log(`[YeelightNet] Dropped ${this.queue.length} queued command(s): ${reason}`);
        this.queue = [];
    }

    /**
     * Помещает команду в очередь и запускает обработку
     */
    send(method, params, id) {
        if (this.stopped) return false;
        const line = JSON.stringify({ id, method, params }) + '\r\n';
        this.queue.push({ line, ts: Date.now() });
        this._log(`[YeelightNet] Pushed ${line}`);
        this.processQueue();
        return true;
    }

    async processQueue() {
        if (this.sending || this.queue.length === 0) return;
        this.sending = true;

        while (this.queue.length > 0) {
            if (!this.isReady()) break;

            const { line, ts } = this.queue.shift();
            if (Date.now() - ts > this.commandTtl) {
                this._log(`[YeelightNet] Dropped stale command ${line}`);
                continue;
            }
            this.socket.write(line);
            this._log(`[YeelightNet] Sending ${line}`);
            // Ждем завершения интервала (throttle)
            await new Promise(res => setTimeout(res, this.interval));
        }

        this.sending = false;
    }

    isReady() {
        return !this.stopped && !!this.socket && !this.socket.destroyed && !this.socket.connecting;
    }

    cleanup() {
        if (this.socket) {
            const socket = this.socket;
            this.socket = null; // close старого сокета не должен планировать reconnect
            try {
                socket.destroy();
            } catch (e) { }
        }
        this.buf = '';
    }

    destroy() {
        this.stopped = true;
        this._clearRetryTimer();
        this.cleanup();
        this.queue = [];
    }
}

if (typeof module !== 'undefined') {
    module.exports = YeelightNet;
}
