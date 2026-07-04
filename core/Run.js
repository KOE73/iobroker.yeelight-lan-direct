// В global должен быть YeelightNet (ваш сетевой класс) и YeelightDevice (этот класс)

const lustra = new YeelightDevice('192.168.199.100', '0_userdata.0.yeelight.lustra');
const color4 = new YeelightDevice('192.168.199.249', '0_userdata.0.yeelight.kitchen');
log('Start Lustra');

onStop(() => {
    lustra.destroy();
    color4.destroy();
}, 2000);