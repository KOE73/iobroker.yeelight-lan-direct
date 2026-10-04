// Минимальная заглушка ioBroker-адаптера: объекты и состояния в памяти,
// плюс счётчики вызовов, чтобы проверять кэширование.

class MockAdapter {
    constructor(namespace = 'yeelight-lan-direct.0') {
        this.namespace = namespace;
        this.objects = new Map();
        this.states = new Map();
        this.logs = [];
        this.calls = { getObject: 0, setObject: 0, extendObject: 0 };
        this.connection = {};
        const log = level => msg => this.logs.push({ level, msg });
        this.log = { debug: log('debug'), info: log('info'), warn: log('warn'), error: log('error') };
    }

    _id(id) {
        return id.startsWith(this.namespace + '.') ? id : `${this.namespace}.${id}`;
    }

    async getObjectAsync(id) {
        this.calls.getObject++;
        const o = this.objects.get(this._id(id));
        return o ? JSON.parse(JSON.stringify(o)) : null;
    }

    async setObjectNotExistsAsync(id, obj) {
        id = this._id(id);
        if (this.objects.has(id)) return;
        this.calls.setObject++;
        this.objects.set(id, JSON.parse(JSON.stringify({ _id: id, ...obj })));
    }

    async extendObjectAsync(id, obj) {
        id = this._id(id);
        this.calls.extendObject++;
        const cur = this.objects.get(id) || { _id: id, common: {}, native: {} };
        cur.common = { ...cur.common, ...(obj.common || {}) };
        cur.native = { ...cur.native, ...(obj.native || {}) };
        if (obj.type) cur.type = obj.type;
        this.objects.set(id, cur);
    }

    async setStateAsync(id, val, ack) {
        this.states.set(this._id(id), { val, ack: !!ack });
    }

    setState(id, val, ack) {
        this.states.set(this._id(id), { val, ack: !!ack });
    }

    async getStateAsync(id) {
        return this.states.get(this._id(id)) || null;
    }

    reportDeviceConnection(host, connected) {
        this.connection[host] = connected;
    }

    val(id) {
        const s = this.states.get(this._id(id));
        return s ? s.val : undefined;
    }

    common(id) {
        const o = this.objects.get(this._id(id));
        return o ? o.common : undefined;
    }

    logsAt(level, re) {
        return this.logs.filter(l => l.level === level && (!re || re.test(l.msg)));
    }
}

module.exports = { MockAdapter };
