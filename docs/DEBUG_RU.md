# Отладка адаптера yeelight-lan

## Структура проекта

```
iobroker.yeelight-lan/
├── main.js              — точка входа адаптера (ioBroker lifecycle)
├── io-package.json      — метаданные адаптера, объекты инстанса
├── package.json         — npm-пакет
├── core/                — чистая логика, без ioBroker-зависимостей
│   ├── YeelightDevice.js    — оркестратор: TCP + объекты ioBroker
│   ├── YeelightNet.js       — TCP-слой, очередь команд (150 мс)
│   ├── YeelightDetect.js    — SSDP-обнаружение (UDP 1982)
│   ├── YeelightCommands.js  — TX_MAP команд (brightness, ct, rgb…)
│   ├── YeelightCapabilities.js — разбор caps из SSDP-ответа
│   ├── YeelightUtils.js     — чистые утилиты
│   ├── YeelightFlowParser.js — парсер flow-эффектов
│   └── Run.js               — запуск core без ioBroker (для тестов)
├── admin/               — UI настроек (JSON-Config)
│   ├── jsonConfig.json      — схема формы настроек
│   └── yeelight.png/banner.png
├── panel/               — standalone-панель управления
│   ├── panel.html
│   ├── panel-server.js      — Express-сервер панели
│   └── device-profiles.js
├── cli/                 — консольные утилиты (Node.js + .cmd обёртки)
│   ├── scan.js / scan.cmd           — обнаружение ламп в сети
│   ├── control.js / control.cmd     — ручная отправка команды лампе
│   ├── all-on/off/ct*.cmd           — быстрые команды на все лампы
│   └── README.md
└── docs/
    ├── DEBUG_RU.md                  — этот файл
    ├── DEPLOY_RU.md                 — деплой на сервер
    └── Yeelight_Inter-Operation_Spec.pdf — протокол JSON-RPC
```

## Тестовые лампы (лабораторная сеть)

| IP | Модель | Возможности |
|---|---|---|
| `192.168.199.100` | `ceilc` | CT + фоновая подсветка |
| `192.168.199.249` | `color4` | CT + HSV/RGB цвет |

Лампы должны иметь включённый **LAN Control** в приложении Yeelight.  
Если SSDP не находит лампы — проверь VPN/multi-interface (на хосте может быть `Meta 198.18.0.1`). Используй режим обнаружения **All interfaces**.

## Локальная лаборатория (Windows)

ioBroker lab: `C:\iobroker.lab`  
Admin UI: http://localhost:8081/  
CLI: `C:\iobroker.lab\iobroker.bat`

### Деплой в lab одной командой

Из корня репо:

```cmd
npm pack && C:\iobroker.lab\iobroker.bat url iobroker.yeelight-lan-*.tgz && C:\iobroker.lab\iobroker.bat upload yeelight-lan && C:\iobroker.lab\iobroker.bat restart yeelight-lan.0
```

Или через скрипт (если перенесли `deploy-lab.cmd` из старого репо).

### Полезные команды lab

```bat
REM Сбросить конфиг устройств
iobroker.bat object set system.adapter.yeelight-lan.0 native.devices=[]

REM Посмотреть состояние объекта
iobroker.bat state get yeelight-lan.0.info.connection

REM Список объектов адаптера
iobroker.bat list objects "yeelight-lan.0.*"

REM Удалить отдельный state (flat id)
iobroker.bat object del yeelight-lan.0.<id>
```

## Деплой на основной сервер

Из корня репо — одна команда через SSH (пример):

```bash
iobroker url github://KOE73/iobroker.yeelight-lan
iobroker upload yeelight-lan
iobroker restart yeelight-lan.0
```

Или через Admin UI: Адаптеры → иконка GitHub → вкладка **Custom** → `github://KOE73/iobroker.yeelight-lan`.

## Отладка без ioBroker

### CLI — скан сети

```cmd
cli\scan.cmd
```

Найдёт все лампы по SSDP и выведет IP, модель, caps.

### CLI — ручная команда

```cmd
cli\control.cmd 192.168.199.249 set_bright 50
```

### Standalone core (Node.js, без ioBroker)

```js
// core/Run.js — запускает YeelightDevice с mock-адаптером
node core/Run.js
```

### Отладка в браузере

Файлы `core/*.js` поддерживают dual-mode (Node + браузер). Открой `panel/panel.html` в браузере — панель работает автономно через WebSocket к `panel-server.js`.

Запуск сервера панели:
```bash
node panel/panel-server.js
# Панель: http://localhost:8088
```

## Частые проблемы

| Симптом | Причина | Решение |
|---|---|---|
| `info.connection` всегда красный | TCP не подключился | Проверь IP лампы, LAN Control в приложении |
| Save в настройках не работает | Старый materialize UI | Убедись что `adminUI.config: "json"` в `io-package.json` |
| Лампы не находятся через Discover | SSDP блокируется VPN/firewall | Режим "All interfaces", проверь UDP 1982 |
| После редактирования таблицы пропали caps | caps не хранятся в таблице | Запусти повторное обнаружение (Discover) |
| `buildTxMap is not defined` | Старая версия без require в core | Обновись — баг исправлен в рефакторинге 2026-06-28 |

## Версии, с которыми проверялось

- js-controller: 7.2.2
- admin: 7.8.23
- Node.js: 20+
