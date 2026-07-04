<img src="admin/yeelight.png" width="72" align="right" alt="logo"/>

# ioBroker.yeelight-lan-direct

**Direct LAN control of Yeelight & Mi lamps — no cloud, no middleman, no compromises.**

[Русская версия / Russian version → README_RU.md](README_RU.md)

Your lamps are on your network. Your commands should be too. This adapter talks to Yeelight devices over raw TCP/JSON-RPC on your LAN — the same protocol the official app uses in local mode — with millisecond response times and zero dependence on anyone's servers.

<p align="center"><img src="docs/img/remote-tab.png" width="420" alt="Built-in remote control tab"/></p>

## Why this adapter

There are other ways to control Yeelight from ioBroker. Here is what makes this one different:

- **Capability-aware objects.** During SSDP discovery the adapter reads what each lamp *actually supports* and creates only those states. A mono bulb won't get dead `hue`/`sat` objects; a ceiling light with ambilight gets the full background-light set (`bg_power`, `bg_ct`, `bg_rgb`, `bg_hue`…). No object-tree garbage.
- **Built-in remote control tab.** A live control panel right in the Admin UI: real-time lamp glow rendered in the lamp's *actual* current color and brightness, capability-gated sliders and buttons, separate ambilight ring for lamps with background light. Not a config page — a remote.
- **Full background-light support.** Power, brightness, color temperature, RGB and HSV for the ambient channel — a feature many alternatives skip entirely.
- **Protocol done right.** Commands go through a throttled async queue (Yeelight firmware silently drops bursts), booleans/enums are normalized, flow (`start_cf`) expressions are parsed both ways. Written against the official Yeelight Inter-Operation Spec, not against guesswork.
- **Incremental control states.** `BRIGHT_UP/DOWN`, `CT_UP/DOWN`, `HUE_CW/CCW` and friends — wire them straight to wall switches and rotary knobs without scripting.
- **Robust discovery.** SSDP on UDP 1982 with multi-interface and manual-target modes — works even on hosts with VPNs and multiple NICs where naive discovery finds nothing.
- **Clean architecture.** The protocol core (`core/`) is pure Node.js with zero ioBroker dependencies — testable standalone, debuggable in a browser, reused by the bundled CLI tools (`cli/scan`, `cli/control`).

The codebase is maintained with an engineer's stubbornness about correctness — layer separation is enforced, every command path is a single well-defined route, and the protocol quirks discovered along the way are documented, not just worked around.

## Requirements

- Lamps with **LAN Control** enabled in the Yeelight app
- js-controller ≥ 5.0.0, Admin ≥ 7 (JSON-Config)
- Node.js ≥ 18

## Installation

Until the adapter reaches the official repository, install from GitHub — Admin → Adapters → GitHub icon → **Custom**:

```
https://github.com/KOE73/iobroker.yeelight-lan-direct
```

or from the command line:

```bash
iobroker url https://github.com/KOE73/iobroker.yeelight-lan-direct.git
iobroker add yeelight-lan-direct
```

> Note: a GitHub install only installs the package — it does not create an instance (that's how `iobroker url` works for any adapter). Either run `iobroker add` as shown above, or press **“+”** on the adapter card in Admin afterwards — that also opens the settings dialog automatically.

## Quick start

1. Create an instance, open its settings.
2. Hit **Discover** — found lamps are merged into the device table together with their capabilities.
3. Save. States appear under `yeelight-lan-direct.0.<deviceId>.*`.
4. Open the **Yeelight remote** tab in the left Admin menu and play.

If discovery finds nothing, switch discovery mode to **All interfaces** (typical on multi-NIC/VPN hosts) and make sure LAN Control is on.

## States overview

| State | Description |
|---|---|
| `power`, `bright` | main light switch and brightness |
| `ct` | color temperature 2700–6500 K |
| `hue`, `sat` | HSV color (if supported) |
| `ON_NORMAL`, `ON_CT`, `ON_RGB`, `ON_HSV`, `ON_FLOW`, `ON_NIGHT`, `OFF` | mode buttons |
| `BRIGHT_UP/DOWN`, `CT_UP/DOWN`, `HUE_CW/CCW`, `SAT_UP/DOWN` | incremental steps |
| `bg_power`, `bg_bright`, `bg_ct`, `bg_rgb`, `bg_hue`, `bg_sat` | background / ambilight channel |
| `flow_params`, `scene`, `delayoff` | flows, scenes, sleep timer |
| `_connected`, `info.connection` | per-lamp and aggregate connection state |

## Changelog

### 0.3.1 (2026-07-04)
- Built-in **remote control tab** in Admin: live lamp glow in real color/brightness, capability-gated controls, background-light ring

### 0.3.0
- Standard ioBroker integration: JSON-Config admin, native `onStateChange` command routing, stable id-based object ids, `info.connection`, adapter-injected core (no global shims)

### 0.2.0
- Capability-aware per-device remote, persisted device caps, fixed command queue draining and state subscriptions

### 0.1.x
- Initial releases: discovery, direct TCP control, logging fixes

## License

MIT © [KOE73](https://github.com/KOE73)
