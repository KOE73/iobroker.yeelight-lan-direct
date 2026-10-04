# Agent Rules — ioBroker.yeelight-lan

Direct TCP/JSON-RPC LAN control of Yeelight & Mi lamps as an ioBroker adapter.

## Installation

```bash
iobroker url github://KOE73/iobroker.yeelight-lan
```

After install, restart the instance from Admin UI or:

```bash
iobroker restart yeelight-lan.0
```

## Architecture & Conventions

- **Framework**: standard ioBroker adapter (`@iobroker/adapter-core`). Follow ioBroker best practices: `onReady`, `onStateChange`, `onMessage`, `onUnload`, `this.log.*`.
- **Discovery**: SSDP on UDP port 1982. On any change to discovery logic ensure sockets are bound, errors handled, and sockets closed in `onUnload`.
- **Core layer** (`core/`): pure device communication — no ioBroker deps. ioBroker-specific logic lives in `main.js` only.
- **Config**: `io-package.json` = adapter metadata + instance object definitions. Keep version in sync with `package.json`.
- **Admin UI**: `admin/` folder. UI field names must match the `native` section of `io-package.json`.

## Core Style Contract

Layer separation is a hard rule — do not mix concerns across layers.

| File | Role | Dependencies |
|---|---|---|
| `YeelightUtils.js`, `YeelightFlowParser.js` | Pure functions | none |
| `YeelightCapabilities.js` | Pure capability logic | none |
| `YeelightNet.js` | TCP layer | injected `log(msg, level)` |
| `YeelightDevice.js` | Orchestrator | adapter instance |
| `YeelightCommands.js` | TX_MAP factory | device instance `d`, `caps` |

**No global shims.** The 2026-06-28 refactor removed all `global.*` injection. `YeelightDevice(adapter, dev)` takes the adapter instance directly. Do not reintroduce globals.

**Dual-mode exports** — every core file works in both Node.js and browser debug panel:
```js
if (typeof module !== 'undefined') {
    module.exports = { ... };
}
```
`YeelightDevice` requires sibling deps via `require` in Node and falls back to `globalThis` script-globals in the browser panel.

**Command routing**: `main.onStateChange(id, state)` (only `state.ack === false`) → `inst.TX_MAP[key]`. No other path.

**Stable object IDs**: `<namespace>.<safe(device.id || ip)>` — never the display name. A `device` node carries `common.name` for the friendly label.

**Logger injection**: network/discovery layers take `log(msg, level)` from the owner (net chatter → `debug`). Pure utility files log nothing.

**Capability gating in TX_MAP**:
```js
const all = !caps || Object.keys(caps).length === 0;
const has = flag => all || !!caps[flag];
```
Empty `caps` = all commands enabled (backward compat with manual config, no discovery).

**No blocking ops.** `YeelightNet` uses a throttled async queue (150 ms interval).

**Reconnect & logging** (`YeelightNet`): retry delay 3 s, doubling up to 60 s, reset on connect. One `warn` per outage, further failures → `debug`; `onStatus(status, msg, changed)` — `YeelightDevice` logs `info` only when `changed`. Do not log per retry.

**Command queue**: dropped on disconnect, and each command has a TTL (5 s). Presses made while the lamp is offline must never be replayed after reconnect.

**Object metadata**: `PROP_META` (roles, min/max/unit) drives type-detector (Matter/HomeKit/Material). `common.write` comes from `TX_MAP`, not from `PROP_META`. `ensureState` creates or *patches* type/role/write/min/max/unit/states of existing objects once per id and caches it — never overwrite `common.name` (user may rename). Background light stays on generic roles (`switch`, `level.dimmer`) so the detector does not confuse it with the main light.

**JSDoc** on public functions in utility files. Classes use inline comments only.

### Known style inconsistencies (do not copy)
- Duplicate section comment in `YeelightCapabilities.js` lines 7–8 — remove on next touch.

## Admin UI — JSON-Config

Settings page uses **JSON-Config** (`admin/jsonConfig.json`, `io-package.json` → `adminUI.config: "json"`). Do NOT revert to legacy materialize `index_m.html` — its save-bridge is broken in admin 7.8 (was the root cause of the "Save does nothing" bug). The leftover `index_m.html`/`words.js` can be removed.

- **Device table** (`type: "table"`): columns `enabled, name, ip, port, model, id`. `caps` is NOT a column — editing the table drops caps, device falls back to "all commands". Discovery sets caps via `useNative`.
- **Discover button** (`type: "sendTo"`, `command: "discover"`, `useNative: true`): `onMessage` returns `{ native: { devices: merged } }` via `_mergeFoundDevices`.
- **Remote control panel**: deferred. If added — JSON-Config custom component or a custom Admin tab. `sendTo('control')` path (`main._controlDevice`) is kept ready.

## info.connection

`main.reportDeviceConnection(host, bool)` aggregates per-device TCP state → standard `info.connection` indicator. Green when ≥1 lamp connected. Set `false` at `onReady` start and in `onUnload`.

## Tests

`npm test` — `node:test`, no extra deps. `test/fake-lamp.js` is a TCP lamp (get_prop, set_*, toggle, props notifications, stop → ECONNREFUSED, dropClients). `test/mock-adapter.js` is an in-memory adapter. Network changes need a test against the fake lamp.

CLI (`cli/`) uses only `core/YeelightDetect.js` + `parseDiscoveryText` — keep their interfaces stable; check with `node cli/scan.js -t 3000`.

## Debugging

See [docs/DEBUG_RU.md](docs/DEBUG_RU.md) for full project structure, lab deployment commands, CLI usage, standalone/browser debugging, and common problems table.

## Test lamps (lab network)

- `192.168.199.100` — model `ceilc` (CT + background light)
- `192.168.199.249` — model `color4` (CT + HSV/color)

LAN Control must be enabled in the Yeelight app. If SSDP discovery misses lamps, check for VPN/multi-interface issues — use "All interfaces" discovery mode.
