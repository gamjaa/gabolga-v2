const _ = require('lodash');
const twit = require('twit');
const botConfig = require('config').get('bot.dm');
const T = new twit(botConfig);
const moment = require('moment')();
const db = require('./routes/common/db');
const telegramSend = require('./routes/telegram');

const excute = async () => {
    const [rows] = await db.query('SELECT tweet_id, name, road_address, address FROM tweet');
    const {tweet_id, name, road_address, address} = rows[_.random(rows.length - 1, false)];

    const status = `${moment.format('M월 D일')}, 오늘의 #가볼가 할 만한 곳\n${name}\n${road_address || address}\nhttps://gabolga.gamjaa.com/tweet/${tweet_id}`;
    await T.post('statuses/update', {
        status
    }).catch(err => {
        telegramSend('자동 트윗 에러', err.stack);
    });

    process.exit();
};

excute();