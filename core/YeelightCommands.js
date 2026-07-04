/**
 * TX_MAP factory for YeelightDevice.
 *
 * @param {object} d    - YeelightDevice instance
 * @param {object} caps - capability flags from YeelightCapabilities.buildCaps()
 *                        If empty/null → include ALL commands (backward compat with ioBroker)
 */
function buildTxMap(d, caps = {}) {
    // If no caps discovered → include everything (ioBroker / manual mode)
    const all = !caps || Object.keys(caps).length === 0;
    const has = flag => all || !!caps[flag];

    const map = {};

    // ─── Buttons always present ───────────────────────────────────────────────
    map.ON_NORMAL = { title: 'ON_NORMAL', isButton: true, jsMethod: () => d.yeelightOnNormal() };
    map.ON_NIGHT  = { title: 'ON_NIGHT',  isButton: true, jsMethod: () => d.yeelightOnNight() };
    map.OFF       = { title: 'OFF',       isButton: true, jsMethod: () => d.yeelightOff() };

    if (has('hasToggle'))    map.TOGGLE = { title: 'TOGGLE', isButton: true, jsMethod: () => d.sendYeelight('toggle', []) };
    if (has('hasDevToggle')) map.DEV_TOGGLE = { title: 'DEV_TOGGLE', isButton: true, jsMethod: () => d.sendYeelight('dev_toggle', []) };
    if (has('hasDefault'))   map.SET_DEFAULT = { title: 'SET_DEFAULT', isButton: true, jsMethod: () => d.sendYeelight('set_default', []) };

    // ─── CT mode ─────────────────────────────────────────────────────────────
    if (has('hasCT')) {
        map.ON_CT = { title: 'ON_CT', isButton: true, jsMethod: () => d.yeelightOnCT() };
        map.ct = val => {
            const v = d.clampInt(val, 2700, 6500);
            return v === null ? null : { method: 'set_ct_abx', params: [v, d.YEELIGHT_EFFECT, d.YEELIGHT_DURATION_MS] };
        };
    }

    // ─── RGB mode ────────────────────────────────────────────────────────────
    if (has('hasRGB')) {
        map.ON_RGB = { title: 'ON_RGB', isButton: true, jsMethod: () => d.yeelightOnRGB() };
    }

    // ─── HSV mode ────────────────────────────────────────────────────────────
    if (has('hasHSV')) {
        map.ON_HSV = { title: 'ON_HSV', isButton: true, jsMethod: () => d.yeelightOnHSV() };
        map.hue = async val => {
            const hue = d.clampInt(val, 0, 359);
            const satState = await d.getStateAsync(`${d.BASE}.sat`);
            const sat = satState?.val !== null ? d.clampInt(satState.val, 0, 100) : d.HSV_DEFAULT_SAT;
            return { method: 'set_hsv', params: [hue, sat, d.YEELIGHT_EFFECT, d.YEELIGHT_DURATION_MS] };
        };
        map.sat = async val => {
            const sat = d.clampInt(val, 0, 100);
            const hueState = await d.getStateAsync(`${d.BASE}.hue`);
            const hue = hueState?.val !== null ? d.clampInt(hueState.val, 0, 359) : d.HSV_DEFAULT_HUE;
            return { method: 'set_hsv', params: [hue, sat, d.YEELIGHT_EFFECT, d.YEELIGHT_DURATION_MS] };
        };
    }

    // ─── Flow mode ───────────────────────────────────────────────────────────
    if (has('hasFlow')) {
        map.ON_FLOW   = { title: 'ON_FLOW', isButton: true, jsMethod: () => d.yeelightOnFlow() };
        map.flow_params = val => {
            if (!val || val === '0' || val === false) {
                d.sendYeelight('stop_cf', []);
                return null;
            }
            const parsed = d.parseFlowParamsForStartCf(val);
            return parsed ? { method: 'start_cf', params: [parsed.count, parsed.action, parsed.expr] } : null;
        };
    }

    // ─── Always: power, bright, name, active_mode ────────────────────────────
    map.power = val => ({
        method: 'set_power',
        params: [d.boolToYeelightPower(val), d.YEELIGHT_EFFECT, d.YEELIGHT_DURATION_MS],
    });

    map.bright = val => {
        const v = d.clampInt(val, 1, 100);
        return v === null ? null : { method: 'set_bright', params: [v, d.YEELIGHT_EFFECT, d.YEELIGHT_DURATION_MS] };
    };

    map.active_mode = val => {
        const v = d.clampInt(val, 0, 1);
        return v === null ? null : {
            method: 'set_power',
            params: ['on', d.YEELIGHT_EFFECT, d.YEELIGHT_DURATION_MS, v === 1 ? 5 : 0],
        };
    };

    map.name = val => (val ? { method: 'set_name', params: [String(val)] } : null);

    // ─── Timers, Scenes, Adjustments ──────────────────────────────────────────
    if (has('hasCron')) {
        map.delayoff = val => {
            const min = parseInt(val, 10);
            if (isNaN(min) || min <= 0) return { method: 'cron_del', params: [0] };
            return { method: 'cron_add', params: [0, min] };
        };
    }
    if (has('hasScene')) {
        map.scene = val => {
            try {
                const args = JSON.parse(val);
                if (Array.isArray(args)) return { method: 'set_scene', params: args };
            } catch (e) {
               return { method: 'set_scene', params: [val] };
            }
        };
    }
    if (has('hasAdjust')) {
        map.adjust_bright = val => {
            const v = d.clampInt(val, -100, 100);
            return v ? { method: 'adjust_bright', params: [v, d.YEELIGHT_DURATION_MS] } : null;
        };
        map.adjust_ct = val => {
            const v = d.clampInt(val, -100, 100);
            return v ? { method: 'adjust_ct', params: [v, d.YEELIGHT_DURATION_MS] } : null;
        };
        map.adjust_color = val => {
            const v = d.clampInt(val, -100, 100);
            return v ? { method: 'adjust_color', params: [v, d.YEELIGHT_DURATION_MS] } : null;
        };
    }
    if (has('hasMusic')) {
         map.music_on = val => {
             // Basic start/stop string input mapping, further mapping usually done in client tools
             if (val === '0' || val === false) return { method: 'set_music', params: [0] };
             // expects host, port when starting... simple toggle for now
         };
    }

    // ─── Background light ─────────────────────────────────────────────────────
    if (has('hasBG')) {
        map.ON_BG  = { title: 'ON_BG',  isButton: true, jsMethod: () => d.yeelightBgOn() };
        map.OFF_BG = { title: 'OFF_BG', isButton: true, jsMethod: () => d.yeelightBgOff() };
        if (has('hasBGToggle'))  map.BG_TOGGLE = { title: 'BG_TOGGLE', isButton: true, jsMethod: () => d.sendYeelight('bg_toggle', []) };
        if (has('hasBGDefault')) map.BG_SET_DEFAULT = { title: 'BG_SET_DEFAULT', isButton: true, jsMethod: () => d.sendYeelight('bg_set_default', []) };

        map.bg_power = val => ({
            method: 'bg_set_power',
            params: [d.boolToYeelightPower(val), d.YEELIGHT_EFFECT, d.YEELIGHT_DURATION_MS],
        });

        map.bg_bright = val => {
            const v = d.clampInt(val, 1, 100);
            return v === null ? null : { method: 'bg_set_bright', params: [v, d.YEELIGHT_EFFECT, d.YEELIGHT_DURATION_MS] };
        };
    }

    // ─── Background RGB / HSV ─────────────────────────────────────────────────
    if (has('hasBGRGB')) {
        map.bg_rgb = val => {
            const v = d.clampInt(val, 0, 16777215);
            return v === null ? null : { method: 'bg_set_rgb', params: [v, d.YEELIGHT_EFFECT, d.YEELIGHT_DURATION_MS] };
        };
        map.bg_r = () => ({ jsMethod: () => d.sendBgRgbFromComponents() });
        map.bg_g = () => ({ jsMethod: () => d.sendBgRgbFromComponents() });
        map.bg_b = () => ({ jsMethod: () => d.sendBgRgbFromComponents() });
    }

    if (has('hasBGHSV')) {
        map.bg_hue = async val => {
            const hue = d.clampInt(val, 0, 359);
            const st  = await d.getStateAsync(`${d.BASE}.bg_sat`);
            const sat = st?.val !== null ? d.clampInt(st.val, 0, 100) : 100;
            return { method: 'bg_set_hsv', params: [hue, sat, d.YEELIGHT_EFFECT, d.YEELIGHT_DURATION_MS] };
        };
        map.bg_sat = async val => {
            const sat    = d.clampInt(val, 0, 100);
            const hState = await d.getStateAsync(`${d.BASE}.bg_hue`);
            const hue    = hState?.val !== null ? d.clampInt(hState.val, 0, 359) : 0;
            return { method: 'bg_set_hsv', params: [hue, sat, d.YEELIGHT_EFFECT, d.YEELIGHT_DURATION_MS] };
        };
    }

    // ─── Background CT ────────────────────────────────────────────────────────
    if (has('hasBGCT')) {
        map.bg_ct = val => ({
            method: 'bg_set_ct_abx',
            params: [d.clampInt(val, 2700, 6500), d.YEELIGHT_EFFECT, d.YEELIGHT_DURATION_MS],
        });
    }

    if (has('hasBGAdjust')) {
        map.bg_adjust_bright = val => {
            const v = d.clampInt(val, -100, 100);
            return v ? { method: 'bg_adjust_bright', params: [v, d.YEELIGHT_DURATION_MS] } : null;
        };
        map.bg_adjust_ct = val => {
            const v = d.clampInt(val, -100, 100);
            return v ? { method: 'bg_adjust_ct', params: [v, d.YEELIGHT_DURATION_MS] } : null;
        };
        map.bg_adjust_color = val => {
            const v = d.clampInt(val, -100, 100);
            return v ? { method: 'bg_adjust_color', params: [v, d.YEELIGHT_DURATION_MS] } : null;
        };
    }

    // ─── Инкрементальные кнопки (авто из d.INCREMENTS) ────────────────────────
    // Гейтим по возможностям лампы, чтобы не плодить лишние объекты (bg_bright у
    // лампы без фона, ct у mono-лампы и т.д.).
    const INC_CAP = { bright: null, ct: 'hasCT', hue: 'hasHSV', sat: 'hasHSV', bg_bright: 'hasBG' };
    if (d.INCREMENTS) {
        for (const [prop, cfg] of Object.entries(d.INCREMENTS)) {
            const capFlag = INC_CAP[prop];
            if (capFlag && !has(capFlag)) continue;
            const upper = prop.toUpperCase();
            // Для wrap-свойств (hue) используем CW/CCW, для остальных UP/DOWN
            const upLabel   = cfg.wrap ? `${upper}_CW`   : `${upper}_UP`;
            const downLabel = cfg.wrap ? `${upper}_CCW`  : `${upper}_DOWN`;
            map[upLabel]   = { title: upLabel,   isButton: true, jsMethod: () => d.adjustProp(prop, +1) };
            map[downLabel] = { title: downLabel, isButton: true, jsMethod: () => d.adjustProp(prop, -1) };
        }
    }

    return map;
}

if (typeof module !== 'undefined') {
    module.exports = { buildTxMap };
}
