/**
 * YeelightCapabilities.js
 * Parses Yeelight SSDP discovery responses and maps raw method names
 * to semantic capability flags used by YeelightDevice and the panel UI.
 */

// ─── Parse raw SSDP response text ─────────────────────────────────────────────
// ─── Parse raw SSDP response text ─────────────────────────────────────────────
function parseDiscoveryText(text) {
    if (!text) return null;

    // Некоторые устройства (или прошивки роутеров типа Keenetic) могут склеивать заголовки 
    // или разделять их пробелами вместо CRLF. 
    // Поэтому сначала пробуем стандартный split, а если не вышло — ищем ключи по всему тексту.
    const lines = text.split(/\r?\n/);

    function get(key) {
        const lo = key.toLowerCase() + ':';
        // 1. Пробуем найти как целую строку (стандарт)
        let line = lines.find(l => l.trim().toLowerCase().startsWith(lo));
        if (line) {
            return line.slice(line.indexOf(':') + 1).trim();
        }

        // 2. Если не нашли, ищем регуляркой (пробельный разделитель)
        const reg = new RegExp(`[\\s\\r\\n]${key}:\\s*([^\\r\\n\\s]+)`, 'i');
        const match = text.match(reg);
        return match ? match[1].trim() : null;
    }

    const location = get('location') || '';
    const locMatch = location.match(/yeelight:\/\/([\d.]+):(\d+)/);
    const ip = locMatch ? locMatch[1] : null;

    // Расширенный поиск IP, если Location нет или он кривой
    let fallbackIp = null;
    if (!ip) {
        const ipMatch = text.match(/([\d]{1,3}\.[\d]{1,3}\.[\d]{1,3}\.[\d]{1,3})/);
        fallbackIp = ipMatch ? ipMatch[1] : null;
    }

    const supportStr = get('support') || '';
    const support = new Set(supportStr.split(/[\s,]+/).filter(Boolean));

    const info = {
        ip: ip || fallbackIp,
        port: locMatch ? parseInt(locMatch[2]) : 55443,
        model: get('model') || 'unknown',
        id: get('id') || `raw_${ip || fallbackIp}`,
        name: get('name') || '',
        state: {
            power: get('power') || '',
            bright: get('bright') || '',
            colorMode: get('color_mode') || '',
            ct: get('ct') || '',
            rgb: get('rgb') || '',
            hue: get('hue') || '',
            sat: get('sat') || '',
        },
        support,
    };
    info.caps = buildCaps(info.support);
    return info;
}

// ─── Map methods → semantic flags ─────────────────────────────────────────────
function buildCaps(support) {
    return {
        hasCT: support.has('set_ct_abx'),
        hasRGB: support.has('set_rgb'),
        hasHSV: support.has('set_hsv'),
        hasFlow: support.has('start_cf'),

        hasToggle: support.has('toggle'),
        hasDevToggle: support.has('dev_toggle'),
        hasDefault: support.has('set_default'),
        hasCron: support.has('cron_add'),
        hasScene: support.has('set_scene'),
        hasAdjust: support.has('set_adjust'),
        hasMusic: support.has('set_music'),

        hasBG: support.has('bg_set_power'),
        hasBGRGB: support.has('bg_set_rgb'),
        hasBGHSV: support.has('bg_set_hsv'),
        hasBGCT: support.has('bg_set_ct_abx'),
        hasBGFlow: support.has('bg_start_cf'),
        hasBGToggle: support.has('bg_toggle'),
        hasBGDefault: support.has('bg_set_default'),
        hasBGScene: support.has('bg_set_scene'),
        hasBGAdjust: support.has('bg_set_adjust') || support.has('bg_adjust_bright'),
    };
}

// ─── Build panel UI profile from caps ────────────────────────────────────────
// Returns null if caps is empty (→ fall back to device-profiles.js)
function buildProfile(caps) {
    if (!caps || Object.keys(caps).length === 0) return null;

    const SL = {
        bright: { id: 'bright', label: 'Яркость', method: 'set_bright', min: 1, max: 100 },
        ct: { id: 'ct', label: 'Темп-ра', method: 'set_ct_abx', min: 2700, max: 6500, suffix: 'K', rowClass: 'ct-track' },
        bgBright: { id: 'bg_bright', label: 'BG ярк.', method: 'bg_set_bright', min: 1, max: 100, rowClass: 'bg-track' },
    };

    const sliders = [SL.bright];
    if (caps.hasCT) sliders.push(SL.ct);

    const buttons = [{ label: 'Normal', action: 'yeelightOnNormal' }];
    if (caps.hasCT) buttons.push({ label: 'CT', action: 'yeelightOnCT' });
    if (caps.hasRGB) buttons.push({ label: 'RGB', action: 'yeelightOnRGB' });
    if (caps.hasHSV) buttons.push({ label: 'HSV', action: 'yeelightOnHSV' });
    if (caps.hasFlow) buttons.push({ label: 'Flow ✦', action: 'yeelightOnFlow' });
    buttons.push({ label: 'Night 🌙', action: 'yeelightOnNight' });

    if (caps.hasToggle) buttons.push({ label: 'Toggle 🔄', action: 'yeelightToggle' });
    if (caps.hasDefault) buttons.push({ label: 'Save Def', action: 'yeelightSetDefault' });

    buttons.push({ label: 'OFF', action: 'yeelightOff', cls: 'btn-off' });

    // ─── Инкрементальные кнопки ──────────────────────────────────────────
    // prop + dir → panel UI вызывает cmd(dev, 'adjustProp', [prop, dir])
    const incButtons = [];
    incButtons.push({ label: 'Bright +', prop: 'bright', dir: 1 });
    incButtons.push({ label: 'Bright −', prop: 'bright', dir: -1 });
    if (caps.hasCT) {
        incButtons.push({ label: 'CT +', prop: 'ct', dir: 1 });
        incButtons.push({ label: 'CT −', prop: 'ct', dir: -1 });
    }
    if (caps.hasHSV) {
        incButtons.push({ label: 'Hue ↻', prop: 'hue', dir: 1 });
        incButtons.push({ label: 'Hue ↺', prop: 'hue', dir: -1 });
        incButtons.push({ label: 'Sat +', prop: 'sat', dir: 1 });
        incButtons.push({ label: 'Sat −', prop: 'sat', dir: -1 });
    }


    const profile = { sliders, buttons, incButtons };

    if (caps.hasBG) {
        profile.bgSliders = [SL.bgBright];
        const bgBtns = [{ label: 'BG ON', action: 'yeelightBgOn', cls: 'btn-bg' }];
        if (caps.hasBGToggle) bgBtns.push({ label: 'BG Toggle 🔄', action: 'yeelightBgToggle', cls: 'btn-bg' });
        if (caps.hasBGDefault) bgBtns.push({ label: 'BG Save Def', action: 'yeelightBgSetDefault', cls: 'btn-bg' });
        bgBtns.push({ label: 'BG OFF', action: 'yeelightBgOff', cls: 'btn-bg btn-off' });
        profile.bgButtons = bgBtns;
        if (caps.hasBGRGB) profile.bgRgb = true;
    }

    return profile;
}

if (typeof module !== 'undefined') {
    module.exports = { parseDiscoveryText, buildCaps, buildProfile };
}
