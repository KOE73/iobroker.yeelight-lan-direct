// JavaScript source code
/**
 * Класс управления устройством Yeelight для ioBroker.
 * Оркестрирует сетевой слой, парсинг состояний и отправку команд.
 *
 * Стандартная интеграция: класс получает экземпляр адаптера ioBroker и работает
 * через его API (setObjectNotExistsAsync / setStateAsync / getStateAsync / log).
 * Никаких глобальных шимов. Подписки на изменения состояний обрабатывает main.js
 * в onStateChange и вызывает device.runCommand().
 */

// Dual-mode dependency wiring: require in Node/ioBroker; fall back to script-scope
// globals in the browser panel.
let YeelightNet, buildTxMap, parseFlowParams, parseFlowParamsForStartCf;
let clampInt, intToRgb, rgbToInt, normalizeBoolStrict, boolToYeelightPower, coerceValue;
if (typeof require === 'function') {
    YeelightNet = require('./YeelightNet');
    ({ buildTxMap } = require('./YeelightCommands'));
    ({ parseFlowParams, parseFlowParamsForStartCf } = require('./YeelightFlowParser'));
    ({ clampInt, intToRgb, rgbToInt, normalizeBoolStrict, boolToYeelightPower, coerceValue } = require('./YeelightUtils'));
} else {
    const g = (typeof globalThis !== 'undefined') ? globalThis : this;
    YeelightNet = g.YeelightNet; buildTxMap = g.buildTxMap;
    parseFlowParams = g.parseFlowParams; parseFlowParamsForStartCf = g.parseFlowParamsForStartCf;
    clampInt = g.clampInt; intToRgb = g.intToRgb; rgbToInt = g.rgbToInt;
    normalizeBoolStrict = g.normalizeBoolStrict; boolToYeelightPower = g.boolToYeelightPower; coerceValue = g.coerceValue;
}

/** Sanitize a value into a safe ioBroker object-id segment. */
function safeSegment(value) {
    return String(value || 'device')
        .trim()
        .replace(/[^\w\-]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '') || 'device';
}

class YeelightDevice {
    /**
     * @param {object} adapter  ioBroker adapter instance (this).
     * @param {object} dev      device config: { id, ip, port, name, model, caps }.
     */
    constructor(adapter, dev) {
        this.adapter = adapter;
        this.HOST = dev.ip;
        this.PORT = dev.port || 55443;
        this.NAME = dev.name || dev.model || dev.ip;

        // Stable object id: derive from the device id, fall back to ip. Never the name.
        this.ID = dev.id || '';
        this.model = dev.model || '';
        this.caps = (dev.caps && typeof dev.caps === 'object') ? dev.caps : {};
        const segment = safeSegment(this.ID || this.HOST);
        this.BASE = `${adapter.namespace}.${segment}`;

        // --- Настройки ---
        this.YEELIGHT_EFFECT = 'smooth';
        this.YEELIGHT_DURATION_MS = 300;
        this.HSV_DEFAULT_SAT = 100;
        this.HSV_DEFAULT_HUE = 0;
        this.COERCE_NUMBERS = true;

        // --- Incremental control config ---
        this.INCREMENTS = {
            bright: { step: 10, min: 1, max: 100, wrap: false, method: 'set_bright' },
            ct: { step: 200, min: 2700, max: 6500, wrap: false, method: 'set_ct_abx' },
            hue: { step: 30, min: 0, max: 359, wrap: true, method: 'set_hsv', companion: 'sat', companionDefault: 100, companionMin: 0, companionMax: 100 },
            sat: { step: 10, min: 0, max: 100, wrap: false, method: 'set_hsv', companion: 'hue', companionDefault: 0, companionMin: 0, companionMax: 359, companionFirst: true },
            bg_bright: { step: 10, min: 1, max: 100, wrap: false, method: 'bg_set_bright' },
        };

        this.cmdId = 1;
        this.lastFlowStepsCount = 0;

        this.logInfo(`Model: ${this.model}  ID: ${this.ID}  caps: ${JSON.stringify(this.caps)}`);

        this.GET_PROP_KEYS = this._buildGetPropKeys();
        this.BOOL_PROPS = new Set(['power', 'main_power', 'bg_power']);

        this.PROP_META = {
            power: { type: 'boolean', role: 'switch' },
            main_power: { type: 'boolean', role: 'switch' },
            bg_power: { type: 'boolean', role: 'switch' },
            active_mode: { type: 'number', role: 'state' },
            bright: { type: 'number', role: 'level.dimmer' },
            active_bright: { type: 'number', role: 'level.dimmer' },
            ct: { type: 'number', role: 'level.color.temperature' },
            bg_bright: { type: 'number', role: 'level.dimmer' },
            bg_ct: { type: 'number', role: 'level.color.temperature' },
            bg_lmode: { type: 'number', role: 'state' },
            nl_br: { type: 'number', role: 'level.dimmer' },
            name: { type: 'string', role: 'info.name' },
            delayoff: { type: 'number', role: 'level.timer' },
            music_on: { type: 'boolean', role: 'switch' },
            scene: { type: 'string', role: 'text' },
            adjust_bright: { type: 'number', role: 'state' },
            adjust_ct: { type: 'number', role: 'state' },
            adjust_color: { type: 'number', role: 'state' },
            bg_adjust_bright: { type: 'number', role: 'state' },
            bg_adjust_ct: { type: 'number', role: 'state' },
            bg_adjust_color: { type: 'number', role: 'state' },
        };

        this.TX_MAP = buildTxMap(this, this.caps);

        this.logInfo('Init net');
        this.yNet = new YeelightNet(this.HOST, this.PORT, {
            onLine: line => this.handleLine(line),
            onStatus: (status, msg) => this.onNetStatus(status, msg),
            interval: 150,
            // Low-level protocol chatter goes to debug; only warn/error surface higher.
            log: (msg, level) => {
                if (level === 'error') this.adapter.log.error(msg);
                else if (level === 'warn') this.adapter.log.warn(msg);
                else this.adapter.log.debug(msg);
            },
        });

        this.logInfo('Init all');
        this.init();
    }

    /** Build the list of properties to fetch via get_prop based on what the lamp supports. */
    _buildGetPropKeys() {
        const caps = this.caps;
        const all = !caps || Object.keys(caps).length === 0;
        const keys = ['power', 'bright', 'active_mode', 'name'];
        if (all || caps.hasCT) keys.push('ct');
        if (all || caps.hasHSV) keys.push('hue', 'sat');
        if (all || caps.hasBG) keys.push('bg_power', 'bg_bright', 'bg_lmode');
        if (all || caps.hasBGRGB) keys.push('bg_rgb');
        if (all || caps.hasBGCT) keys.push('bg_ct');
        if (all || caps.hasFlow) keys.push('nl_br');
        if (all || caps.hasCron) keys.push('delayoff');
        if (all || caps.hasMusic) keys.push('music_on');
        return keys;
    }

    // -------------------------------------------------------------------------
    // Инициализация
    // -------------------------------------------------------------------------

    init() {
        // Named device node with a stable id; display name comes from common.name.
        this.adapter.setObjectNotExists(this.BASE, {
            type: 'device',
            common: { name: this.NAME },
            native: { ip: this.HOST, id: this.ID, model: this.model },
        });

        this.ensureState(`${this.BASE}._connected`, { name: 'connected', type: 'number', role: 'indicator.connected', write: false });
        this.ensureState(`${this.BASE}._last_error`, { name: 'last_error', type: 'string', role: 'text', write: false });
        this.initButtons();
        this.yNet.connect();
    }

    destroy() {
        this.yNet.destroy();
    }

    // -------------------------------------------------------------------------
    // Сеть
    // -------------------------------------------------------------------------

    onNetStatus(status, msg) {
        this.logInfo(`onNetStatus status=${status} msg=${msg}`);
        this.safeSetState('_connected', status);
        this.adapter.reportDeviceConnection(this.HOST, status === 1);
        if (status === 1) {
            this.syncYeelightProps();
            this.safeSetState('_last_error', 'OK');
        } else {
            this.safeSetState('_last_error', msg);
        }
    }

    syncYeelightProps() {
        this.sendYeelight('get_prop', this.GET_PROP_KEYS);
    }

    sendYeelight(method, params) {
        return this.yNet.send(method, params, this.cmdId++);
    }

    // -------------------------------------------------------------------------
    // Приём и парсинг
    // -------------------------------------------------------------------------

    handleLine(line) {
        const raw = line.trim();
        if (!raw) return;

        let msg;
        try { msg = JSON.parse(raw); } catch (e) { return; }

        if (this.tryParseGetPropResult(msg)) return;

        if (msg && msg.method === 'props' && msg.params && typeof msg.params === 'object') {
            Object.keys(msg.params).forEach(k => this.processIncomingProp(k, msg.params[k]));
            this.safeSetState('_last_props_json', msg);
            this.safeSetState('_last_seen_ts', Date.now());
            return;
        }
        this.safeSetState('_last_other_json', msg);
    }

    tryParseGetPropResult(msg) {
        if (!msg.result || !Array.isArray(msg.result) || msg.result.length !== this.GET_PROP_KEYS.length) {
            return false;
        }
        msg.result.forEach((val, index) => {
            const key = this.GET_PROP_KEYS[index];
            if (key) this.processIncomingProp(key, val);
        });
        return true;
    }

    processIncomingProp(k, rawVal) {
        const v = this.coerceValue(rawVal);
        this.safeSetState(k, v);

        if (k === 'flow_params' && typeof v === 'string') {
            const parsed = parseFlowParams(v);
            if (parsed) {
                this.safeSetState('flow.count', parsed.count);
                this.safeSetState('flow.action', parsed.action);
                this.safeSetState('flow.steps_json', parsed.steps);
                this.safeSetState('flow.parse_error', null);
                const newCount = parsed.steps.length;
                for (let i = 0; i < newCount; i++) this.writeFlowStep(i, parsed.steps[i]);
                for (let i = newCount; i < this.lastFlowStepsCount; i++) this.writeFlowStep(i, null);
                this.lastFlowStepsCount = newCount;
                this.safeSetState('flow.steps_count', newCount);
            } else {
                this.safeSetState('flow.parse_error', 'unable_to_parse');
                for (let i = 0; i < this.lastFlowStepsCount; i++) this.writeFlowStep(i, null);
                this.lastFlowStepsCount = 0;
                this.safeSetState('flow.steps_count', 0);
            }
        }

        if (k === 'bg_rgb' && typeof v === 'number') {
            const rgb = intToRgb(v);
            if (rgb) {
                this.safeSetState('bg_r', rgb.r);
                this.safeSetState('bg_g', rgb.g);
                this.safeSetState('bg_b', rgb.b);
            }
        }
    }

    // -------------------------------------------------------------------------
    // ioBroker state helpers (через adapter)
    // -------------------------------------------------------------------------

    ensureState(id, common) {
        return this.adapter.setObjectNotExistsAsync(id, {
            type: 'state',
            common: {
                name: common.name ?? id,
                type: common.type ?? 'mixed',
                role: common.role ?? 'state',
                read: common.read !== false,
                write: common.write !== false,
                def: common.def ?? null,
            },
            native: {},
        });
    }

    async safeSetState(stateId, value) {
        const id = `${this.BASE}.${stateId}`.replace(/[^\w.\-]/g, '_');
        let v = this.normalizeProp(stateId, value);
        if (v !== null && typeof v === 'object') v = JSON.stringify(v);

        const meta = this.PROP_META[stateId] || {};
        const t = meta.type ?? (typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : 'string');

        try {
            await this.ensureState(id, { name: id, type: t, role: meta.role ?? 'state' });
            await this.adapter.setStateAsync(id, v, true);
        } catch (e) {
            this.logError(`setState failed for ${id}: ${e.message}`);
        }
    }

    getStateAsync(id) {
        return this.adapter.getStateAsync(id);
    }

    // -------------------------------------------------------------------------
    // Утилиты — делегируем в YeelightUtils.js
    // -------------------------------------------------------------------------

    coerceValue(v) { return this.COERCE_NUMBERS ? coerceValue(v) : v; }
    normalizeProp(stateId, v) { return this.BOOL_PROPS.has(stateId) ? normalizeBoolStrict(v) : v; }
    clampInt(v, min, max) { return clampInt(v, min, max); }
    boolToYeelightPower(v) { return boolToYeelightPower(v); }
    parseFlowParamsForStartCf(v) { return parseFlowParamsForStartCf(v); }

    // -------------------------------------------------------------------------
    // Flow steps — запись в ioBroker
    // -------------------------------------------------------------------------

    writeFlowStep(index, step) {
        const base = `flow.step_${index + 1}`;
        if (!step) {
            ['duration', 'mode', 'value', 'bright'].forEach(k => this.safeSetState(`${base}.${k}`, null));
            return;
        }
        this.safeSetState(`${base}.duration`, step.duration);
        this.safeSetState(`${base}.mode`, step.mode);
        this.safeSetState(`${base}.value`, step.value);
        this.safeSetState(`${base}.bright`, step.bright);
    }

    // -------------------------------------------------------------------------
    // RGB по компонентам
    // -------------------------------------------------------------------------

    async sendBgRgbFromComponents() {
        const sr = await this.getStateAsync(`${this.BASE}.bg_r`);
        const sg = await this.getStateAsync(`${this.BASE}.bg_g`);
        const sb = await this.getStateAsync(`${this.BASE}.bg_b`);
        if (!sr || !sg || !sb) return;
        this.sendYeelight('bg_set_rgb', [rgbToInt(sr.val, sg.val, sb.val), this.YEELIGHT_EFFECT, this.YEELIGHT_DURATION_MS]);
    }

    // -------------------------------------------------------------------------
    // Кнопки
    // -------------------------------------------------------------------------

    initButtons() {
        Object.entries(this.TX_MAP).forEach(([key, cfg]) => {
            if (!cfg || !cfg.isButton) return;
            const id = `${this.BASE}.${key}`;
            this.ensureState(id, { name: cfg.title, type: 'boolean', role: 'button', read: false, write: true, def: false })
                .then(() => this.adapter.setState(id, false, true));
        });
    }

    // -------------------------------------------------------------------------
    // Команды питания
    // -------------------------------------------------------------------------

    yeelightSetPower(power, mode = null, effect = this.YEELIGHT_EFFECT, duration = this.YEELIGHT_DURATION_MS) {
        const params = [boolToYeelightPower(power), effect, duration];
        if (mode !== null) params.push(clampInt(mode, 0, 5));
        this.sendYeelight('set_power', params);
    }

    yeelightSetBgPower(power, effect = this.YEELIGHT_EFFECT, duration = this.YEELIGHT_DURATION_MS) {
        this.sendYeelight('bg_set_power', [boolToYeelightPower(power), effect, duration]);
    }

    yeelightOff() { return this.yeelightSetPower('off'); }
    yeelightOnNormal() { return this.yeelightSetPower('on', 0); }
    yeelightOnCT() { return this.yeelightSetPower('on', 1); }
    yeelightOnRGB() { return this.yeelightSetPower('on', 2); }
    yeelightOnHSV() { return this.yeelightSetPower('on', 3); }
    yeelightOnFlow() { return this.yeelightSetPower('on', 4); }
    yeelightOnNight() { return this.yeelightSetPower('on', 5); }

    yeelightToggle() { this.sendYeelight('toggle', []); }
    yeelightDevToggle() { this.sendYeelight('dev_toggle', []); }
    yeelightSetDefault() { this.sendYeelight('set_default', []); }

    yeelightBgOn(effect = this.YEELIGHT_EFFECT, duration = this.YEELIGHT_DURATION_MS) { this.yeelightSetBgPower('on', effect, duration); }
    yeelightBgOff(effect = this.YEELIGHT_EFFECT, duration = this.YEELIGHT_DURATION_MS) { this.yeelightSetBgPower('off', effect, duration); }

    yeelightBgToggle() { this.sendYeelight('bg_toggle', []); }
    yeelightBgSetDefault() { this.sendYeelight('bg_set_default', []); }

    // -------------------------------------------------------------------------
    // Инкрементальное управление (adjustProp)
    // -------------------------------------------------------------------------

    async adjustProp(prop, direction) {
        const cfg = this.INCREMENTS[prop];
        if (!cfg) { this.logWarn(`adjustProp: unknown prop "${prop}"`); return; }

        const state = await this.getStateAsync(`${this.BASE}.${prop}`);
        let current = (state?.val !== null && state?.val !== undefined) ? Number(state.val) : cfg.min;
        let next = current + cfg.step * direction;

        if (cfg.wrap) {
            const range = cfg.max - cfg.min + 1;
            next = ((next - cfg.min) % range + range) % range + cfg.min;
        } else {
            next = clampInt(next, cfg.min, cfg.max);
        }
        if (next === null) return;

        if (cfg.companion) {
            const compState = await this.getStateAsync(`${this.BASE}.${cfg.companion}`);
            const comp = compState?.val !== null ? clampInt(compState.val, cfg.companionMin, cfg.companionMax) : cfg.companionDefault;
            if (cfg.companionFirst) {
                this.sendYeelight(cfg.method, [comp, next, this.YEELIGHT_EFFECT, this.YEELIGHT_DURATION_MS]);
            } else {
                this.sendYeelight(cfg.method, [next, comp, this.YEELIGHT_EFFECT, this.YEELIGHT_DURATION_MS]);
            }
        } else {
            this.sendYeelight(cfg.method, [next, this.YEELIGHT_EFFECT, this.YEELIGHT_DURATION_MS]);
        }

        this.logDebug(`adjustProp ${prop} ${direction > 0 ? '+' : ''}${cfg.step}: ${current} → ${next}`);
    }

    // -------------------------------------------------------------------------
    // Логирование (через adapter.log)
    // -------------------------------------------------------------------------

    logDebug(msg) { this.adapter.log.debug(`[${this.HOST}] ${msg}`); }
    logInfo(msg) { this.adapter.log.info(`[${this.HOST}] ${msg}`); }
    logWarn(msg) { this.adapter.log.warn(`[${this.HOST}] ${msg}`); }
    logError(msg) { this.adapter.log.error(`[${this.HOST}] ${msg}`); }
}

if (typeof module !== 'undefined') {
    module.exports = YeelightDevice;
}
