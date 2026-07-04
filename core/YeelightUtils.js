// Pure utility functions for Yeelight — no ioBroker, no network dependencies.

/**
 * Clamps a value to [min, max] as integer.
 * Returns null if the value cannot be a finite number.
 */
function clampInt(v, min, max) {
    v = Number(v);
    if (!Number.isFinite(v)) return null;
    return Math.max(min, Math.min(max, Math.round(v)));
}

/**
 * Converts a 24-bit integer to an {r, g, b} object.
 * Returns null if the value is not finite.
 */
function intToRgb(v) {
    v = Number(v);
    if (!Number.isFinite(v)) return null;
    return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

/**
 * Converts r, g, b components to a 24-bit integer.
 */
function rgbToInt(r, g, b) {
    return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/**
 * Strictly converts any value to boolean.
 * Understands: 'on'/'off', 'true'/'false', '1'/'0', numbers.
 */
function normalizeBoolStrict(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        if (s === 'on' || s === 'true' || s === '1') return true;
        if (s === 'off' || s === 'false' || s === '0') return false;
    }
    return !!v;
}

/**
 * Convert any truthy/falsy power value to Yeelight string 'on' or 'off'.
 */
function boolToYeelightPower(v) {
    return normalizeBoolStrict(v) ? 'on' : 'off';
}

/**
 * Coerce a string that looks like a number to an actual number.
 * Other types are returned as-is.
 */
function coerceValue(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
        const s = v.trim();
        if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    }
    return v;
}

if (typeof module !== 'undefined') {
    module.exports = { clampInt, intToRgb, rgbToInt, normalizeBoolStrict, boolToYeelightPower, coerceValue };
}
