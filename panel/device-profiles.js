/**
 * device-profiles.js
 * Per-device UI capability profiles.
 * The key is the device name — last segment of baseName (e.g. "lustra", "kitchen").
 * Use "__default__" for any device not explicitly listed.
 *
 * Slider fields:
 *   id       — state key (used for sync and slider element ID)
 *   label    — display label
 *   method   — Yeelight method for sendYeelight()
 *   min/max  — range bounds
 *   suffix   — text after value (e.g. 'K')
 *   rowClass — extra CSS class on the slider row (e.g. 'ct-track', 'bg-track')
 *
 * Button fields:
 *   label  — button text
 *   action — method name on YeelightDevice instance
 *   cls    — extra CSS classes (e.g. 'btn-off', 'btn-bg btn-off')
 */

const BTN = {
    onCT:    { label: 'CT',       action: 'yeelightOnCT' },
    onNorm:  { label: 'Normal',   action: 'yeelightOnNormal' },
    onRGB:   { label: 'RGB',      action: 'yeelightOnRGB' },
    onHSV:   { label: 'HSV',      action: 'yeelightOnHSV' },
    onFlow:  { label: 'Flow ✦',   action: 'yeelightOnFlow' },
    onNight: { label: 'Night 🌙', action: 'yeelightOnNight' },
    off:     { label: 'OFF',      action: 'yeelightOff',   cls: 'btn-off' },
    bgOn:    { label: 'BG ON',    action: 'yeelightBgOn',  cls: 'btn-bg' },
    bgOff:   { label: 'BG OFF',   action: 'yeelightBgOff', cls: 'btn-bg btn-off' },
};

const INC = {
    brightUp:   { label: 'Bright +', prop: 'bright', dir: 1 },
    brightDown: { label: 'Bright −', prop: 'bright', dir: -1 },
    ctUp:       { label: 'CT +',     prop: 'ct',     dir: 1 },
    ctDown:     { label: 'CT −',     prop: 'ct',     dir: -1 },
    hueCW:      { label: 'Hue ↻',   prop: 'hue',    dir: 1 },
    hueCCW:     { label: 'Hue ↺',   prop: 'hue',    dir: -1 },
    satUp:      { label: 'Sat +',    prop: 'sat',    dir: 1 },
    satDown:    { label: 'Sat −',    prop: 'sat',    dir: -1 },
    bgBrUp:     { label: 'BG Br +',  prop: 'bg_bright', dir: 1 },
    bgBrDown:   { label: 'BG Br −',  prop: 'bg_bright', dir: -1 },
};

const SL = {
    bright:    { id: 'bright',    label: 'Яркость',  method: 'set_bright',    min: 1,    max: 100 },
    ct:        { id: 'ct',        label: 'Темп-ра',  method: 'set_ct_abx',    min: 2700, max: 6500, suffix: 'K', rowClass: 'ct-track' },
    bgBright:  { id: 'bg_bright', label: 'BG ярк.',  method: 'bg_set_bright', min: 1,    max: 100,  rowClass: 'bg-track' },
};

const profiles = {

    // ─── Люстра с фоновой подсветкой ────────────────────────────────────────
    lustra: {
        label: 'Люстра',
        sliders:   [SL.bright, SL.ct],
        bgSliders: [SL.bgBright],
        bgRgb:     true,
        buttons:   [BTN.onCT, BTN.onNorm, BTN.onFlow, BTN.onNight, BTN.off],
        bgButtons: [BTN.bgOn, BTN.bgOff],
        incButtons: [INC.brightUp, INC.brightDown, INC.ctUp, INC.ctDown, INC.bgBrUp, INC.bgBrDown],
    },

    // ─── Цветная лампа E27 (CT + RGB) ───────────────────────────────────────
    kitchen: {
        label: 'Лампа CT+RGB',
        sliders:   [SL.bright, SL.ct],
        buttons:   [BTN.onCT, BTN.onNorm, BTN.onRGB, BTN.onNight, BTN.off],
        incButtons: [INC.brightUp, INC.brightDown, INC.ctUp, INC.ctDown, INC.hueCW, INC.hueCCW],
    },

    // ─── Простая лампа (только яркость + CT) ────────────────────────────────
    simple: {
        label: 'Лампа CT',
        sliders: [SL.bright, SL.ct],
        buttons: [BTN.onCT, BTN.onNorm, BTN.onNight, BTN.off],
        incButtons: [INC.brightUp, INC.brightDown, INC.ctUp, INC.ctDown],
    },

    // ─── По умолчанию (для неизвестных ламп) ────────────────────────────────
    __default__: {
        sliders: [SL.bright],
        buttons: [BTN.onCT, BTN.onNorm, BTN.off],
        incButtons: [INC.brightUp, INC.brightDown],
    },
};

if (typeof module !== 'undefined') module.exports = profiles;
