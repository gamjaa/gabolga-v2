const _ = require('lodash');
const twit = require('twit');
const botConfig = require('config').get('bot.dm');
const T = new twit(botConfig);
const moment = require('moment')();
const db = require('./routes/common/db');
const telegramSend = require('./routes/common/telegram');

const excute = async () => {
    const [rows] = await db.query('SELECT tweet_id, name, road_address, address FROM tweet');

    const getRandomIndex = async () => {
        const i = _.random(rows.length - 1, false);
        return await T.get('statuses/oembed', {
            id: rows[i].tweet_id
        }).then(() => i).catch(() => Promise.resolve(getRandomIndex()));
    };

    const i = await getRandomIndex();
    const {tweet_id, name, road_address, address} = rows[i];

    const status = `${moment.format('M월 D일')}, 오늘의 #가볼가 할 만한 곳\n${name}\n${road_address || address}\nhttps://gabolga.gamjaa.com/tweet/${tweet_id}`;
    await T.post('statuses/update', {
        status
    }).catch(err => {
        telegramSend(['자동 트윗 에러', err.stack]);
    });

    process.exit();
};

excute();