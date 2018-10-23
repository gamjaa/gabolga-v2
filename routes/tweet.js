const express = require('express');
const router = express.Router();
const _ = require('lodash');
const db = require('./common/db');
const wrapAsync = require('./common/wrapAsync');
const twit = require('./common/twit');
const postBotConfig = require('config').get('bot.post');
const postT = new require('twit')(postBotConfig);

const statusIdRegex = /status\/([0-9]+)/;
const idRegex = /^([0-9]+)$/;

// GET /tweet/:id
router.get('/:id', wrapAsync(async (req, res, next) => {
    if (statusIdRegex.test(req.params.id)) {
        return res.redirect(301, `/tweet/${statusIdRegex.exec(req.params.id)[1]}`);
    }

    if (!idRegex.test(req.params.id)) {
        return res.status(400).send();
    }
    
    const id = idRegex.exec(req.params.id)[1];
    const query = !req.session.isLogin 
        ? `SELECT name, address, road_address, phone, lat, lng, image_url 
        FROM tweet WHERE tweet.tweet_id=?`
        : `SELECT name, address, road_address, phone, lat, lng, image_url, user_id 
        FROM tweet 
        LEFT JOIN my_map ON (tweet.tweet_id=my_map.tweet_id AND my_map.user_id='${req.session.user_id}')
        WHERE tweet.tweet_id=?`;
    const [rows] = await db.query(query, [id]);
    const T = twit();
    const result = await T.get('statuses/oembed', {
        id, 
        hide_media: true, 
        hide_thread: true, 
        lang: 'ko'
    }).catch(() => Promise.resolve({ data: { html: '<div id="data" style="line-height: 100px; text-align: center;">삭제되거나 비공개된 트윗입니다</div>' } }));
    return res.render('tweet', { 
        req,
        title: _.get(rows, '[0].name'),
        isRegistered: rows.length,
        
        tweetHtml: result.data.html,
        id, 
        name: _.get(rows, '[0].name'),
        address: _.get(rows, '[0].address'),
        roadAddress: _.get(rows, '[0].road_address'),
        phone: _.get(rows, '[0].phone'),
        lat: _.get(rows, '[0].lat'),
        lng: _.get(rows, '[0].lng'),
        imageUrl: _.get(rows, '[0].image_url'),

        isGabolga: _.get(rows, '[0].user_id'),
    });
}));

// PUT /tweet/:id
// 등록 및 수정 요청
router.put('/:id', wrapAsync(async (req, res, next) => {
    if (!req.session.isLogin) {
        return res.status(400).send();
    }

    if (!(req.body.name && (req.body.address || req.body.road_address) && req.body.lat && req.body.lng)) {
        return res.status(400).send();
    }

    if (statusIdRegex.test(req.params.id)) {
        return res.redirect(301, `/tweet/${statusIdRegex.exec(req.params.id)[1]}`);
    }

    if (!idRegex.test(req.params.id)) {
        return res.status(400).send();
    }

    const id = idRegex.exec(req.params.id)[1];
    const [rows] = await db.query('SELECT name FROM tweet WHERE tweet_id=?', [id]);
    if (rows.length) {
        return res.status(400).send();
    }

    await db.query(`INSERT INTO tweet (tweet_id, name, address, road_address, phone, lat, lng, writer) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
    [id, req.body.name, req.body.address, req.body.road_address, req.body.phone, req.body.lat, req.body.lng, req.session.user_id]);

    const {data} = await postT.get('statuses/show', {
        id
    });
    await postT.post('statuses/update', {
        status: `@${data.user.screen_name} ${req.body.name}\n${req.body.road_address || req.body.address}\n#가볼가 에서 '${req.body.name}'의 위치를 확인해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}`,
        in_reply_to_status_id: id
    }).catch(err => console.error(err));

    const [users] = await db.query('SELECT is_auto_tweet FROM users WHERE user_id=?', [req.session.user_id]);
    if (users[0].is_auto_tweet) {
        const T = twit(req.session.oauth_token, req.session.oauth_token_secret);
        await T.post('statuses/update', {
            status: `#가볼가 에 '${req.body.name}'을(를) 등록했어요!\nhttps://gabolga.gamjaa.com/tweet/${id}`
        });
    }
            
    return res.status(200).send();
}));

module.exports = router;
