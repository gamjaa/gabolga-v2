const express = require('express');
const router = express.Router();
const _ = require('lodash');
const db = require('./common/db');
const wrapAsync = require('./common/wrapAsync');
const getNewTwit = require('./common/twit');
const config = require('config');
const appT = require('./common/twit')();
const postBotConfig = config.get('bot.post');
const postT = new require('twit')(postBotConfig);
const telegramSend = require('./common/telegram');
const setMentionPermission = require('./common/setMentionPermissionAsync');
const isSendMention = require('./common/isSendMentionAsync');

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
        ? `SELECT name, address, road_address, phone, lat, lng 
        FROM tweet WHERE tweet.tweet_id=?`
        : `SELECT name, address, road_address, phone, lat, lng, user_id 
        FROM tweet 
        LEFT JOIN (SELECT * FROM my_map WHERE user_id='${req.session.user_id}') AS my_map ON tweet.tweet_id=my_map.tweet_id
        WHERE tweet.tweet_id=?`;
    const [tweets] = await db.query(query, [id]);
    const [tweetUpdates] = await db.query('SELECT tweet_id FROM tweet_update WHERE tweet_id=?', [id]);
    const T = getNewTwit();
    const result = await T.get('statuses/oembed', {
        id, 
        hide_media: true, 
        hide_thread: true, 
        lang: 'ko'
    }).catch(() => Promise.resolve({ data: { html: '<div id="data" style="line-height: 100px; text-align: center;">삭제되거나 비공개된 트윗입니다</div>' } }));
    return res.render('tweet', { 
        req,
        title: _.get(tweets, '[0].name'),
        isUpdatePage: 0,
        isRegistered: tweets.length,
        hasUpdate: tweetUpdates.length,
        
        tweetHtml: result.data.html,
        id, 
        name: _.get(tweets, '[0].name'),
        address: _.get(tweets, '[0].address'),
        roadAddress: _.get(tweets, '[0].road_address'),
        phone: _.get(tweets, '[0].phone'),
        lat: _.get(tweets, '[0].lat'),
        lng: _.get(tweets, '[0].lng'),

        isGabolga: _.get(tweets, '[0].user_id'),
    });
}));

// PUT /tweet/:id
// 등록
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

    const {data} = await appT.get('statuses/show', {
        id
    });
    if (isSendMention(data, req.session.user_id)) {
        await postT.post('statuses/update', {
            status: `@${data.user.screen_name} ${req.body.name}\n${req.body.road_address || req.body.address}\n#가볼가 에서 나만의 지도에 '${req.body.name}'을(를) 기록해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}`,
            in_reply_to_status_id: id
        }).catch(async () => Promise.resolve(await setMentionPermission(data.user.id_str, true)));
    }

    const [users] = await db.query('SELECT oauth_token, oauth_token_secret, is_auto_tweet FROM users WHERE user_id=?', [req.session.user_id]);
    if (users[0].is_auto_tweet) {
        const T = getNewTwit(users[0].oauth_token, users[0].oauth_token_secret);
        await T.post('statuses/update', {
            status: `#가볼가 에 '${req.body.name}'을(를) 등록했어요!\nhttps://gabolga.gamjaa.com/tweet/${id}`
        });
    }

    const [alreadyGabolgas] = await db.query('SELECT user_id FROM my_map WHERE tweet_id=? AND user_id!=?', [id, req.session.user_id]);
    alreadyGabolgas.forEach(async gabolga => {
        await sendDM(gabolga.user_id, {
            text: `가볼가 해두셨던 트윗에 장소가 등록됐어요. 지금 확인해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}`,
            ctas: [
                {
                    type: 'web_url',
                    label: '내 지도 보기',
                    url: `https://gabolga.gamjaa.com/my/map?tweet_id=${id}`
                }
            ]
        });
    });
            
    await sendDM(req.session.user_id, {
        text: `등록해주셔서 감사합니다. ${req.session.screen_name} 님의 지도에 '${req.body.name}'이(가) 기록되었습니다!`,
        ctas: [
            {
                type: 'web_url',
                label: '내 지도 보기',
                url: `https://gabolga.gamjaa.com/my/map?tweet_id=${id}`
            }
        ]
    }).catch(() => Promise.resolve());

    return res.status(200).send();
}));

// GET /tweet/:id/update
// 수정 요청 페이지
router.get('/:id/update', wrapAsync(async (req, res, next) => {
    if (!req.session.isLogin) {
        return res.redirect(`/login?refer=${req.originalUrl}`);
    }

    if (!idRegex.test(req.params.id)) {
        return res.status(400).send();
    }
    
    const id = idRegex.exec(req.params.id)[1];
    const [tweets] = await db.query(`SELECT name, address, road_address, phone, lat, lng, user_id 
    FROM tweet_update 
    LEFT JOIN my_map ON (tweet_update.tweet_id=my_map.tweet_id AND my_map.user_id=?)
    WHERE tweet_update.tweet_id=?`, [req.session.user_id, id]);
    const T = getNewTwit();
    const result = await T.get('statuses/oembed', {
        id, 
        hide_media: true, 
        hide_thread: true, 
        lang: 'ko'
    }).catch(() => Promise.resolve({ data: { html: '<div id="data" style="line-height: 100px; text-align: center;">삭제되거나 비공개된 트윗입니다</div>' } }));

    return res.render('tweet', { 
        req,
        title: '수정 요청',
        isUpdatePage: 1,
        isRegistered: tweets.length,
        hasUpdate: 1,
        
        tweetHtml: result.data.html,
        id, 
        name: _.get(tweets, '[0].name'),
        address: _.get(tweets, '[0].address'),
        roadAddress: _.get(tweets, '[0].road_address'),
        phone: _.get(tweets, '[0].phone'),
        lat: _.get(tweets, '[0].lat'),
        lng: _.get(tweets, '[0].lng'),

        isGabolga: _.get(tweets, '[0].user_id'),
    });
}));

// POST /tweet/:id/update
// 수정 요청
router.post('/:id/update', wrapAsync(async (req, res, next) => {
    if (!req.session.isLogin) {
        return res.redirect(`/login?refer=${req.originalUrl}`);
    }

    if (!(req.body.name && (req.body.address || req.body.road_address) && req.body.lat && req.body.lng)) {
        return res.status(400).send();
    }

    await db.query(`INSERT IGNORE INTO tweet_update (tweet_id, name, address, road_address, phone, lat, lng, writer) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
    [req.params.id, req.body.name, req.body.address, req.body.road_address, req.body.phone, req.body.lat, req.body.lng, req.session.user_id]);

    await telegramSend(['수정 요청', req.body, 'https://gabolga.gamjaa.com/admin/tweet']);

    return res.status(200).send();
}));

module.exports = router;

async function sendDM(target_id, message_data) {
    return postT.post('direct_messages/events/new', {
        event: {
            type: 'message_create',
            message_create: {
                target: {
                    recipient_id: target_id
                },
                message_data
            }
        }
    });
}
