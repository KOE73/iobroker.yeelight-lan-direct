// Flow string parsing for Yeelight — no ioBroker, no network dependencies.

/**
 * Parse a Yeelight flow_params string into a structured object.
 * Format: "count,action,duration,mode,value,bright[,...]"
 *
 * @param {string} flowStr
 * @returns {{ count: number, action: number, steps: Array }} | null
 */
function parseFlowParams(flowStr) {
    if (typeof flowStr !== 'string') return null;
    const parts = flowStr
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
    if (parts.length < 2) return null;
    const count = Number(parts[0]);
    const action = Number(parts[1]);
    const rest = parts.slice(2).map(Number);
    if (rest.some(x => !Number.isFinite(x))) return null;
    const steps = [];
    for (let i = 0; i + 3 < rest.length; i += 4) {
        steps.push({ duration: rest[i], mode: rest[i + 1], value: rest[i + 2], bright: rest[i + 3] });
    }
    return { count, action, steps };
}

/**
 * Parse a flow string for use as start_cf command parameters.
 * Returns { count, action, expr } or null.
 *
 * @param {string} flowStr
 * @returns {{ count: number, action: number, expr: string }} | null
 */
function parseFlowParamsForStartCf(flowStr) {
    if (typeof flowStr !== 'string') return null;
    const parts = flowStr
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    if (parts.length < 2) return null;
    const rest = parts.slice(2);
    if (rest.length === 0 || rest.length % 4 !== 0) return null;
    return {
        count: Math.trunc(Number(parts[0])),
        action: Math.trunc(Number(parts[1])),
        expr: rest.join(','),
    };
}

if (typeof module !== 'undefined') {
    module.exports = { parseFlowParams, parseFlowParamsForStartCf };
}
