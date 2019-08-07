const express = require('express');
const router = express.Router();
const _ = require('lodash');
const db = require('./common/db');
const wrapAsync = require('./common/wrapAsync');
const getNewTwit = require('./common/twit');
const config = require('config');
const T = getNewTwit();
const postBotConfig = config.get('bot.post');
const postT = new require('twit')(postBotConfig);
const telegramSend = require('./common/telegram');
const Mention = require('./common/Mention');

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
        ? `SELECT name, address, road_address, phone, mapx, mapy 
        FROM tweet WHERE tweet.tweet_id=?`
        : `SELECT name, address, road_address, phone, mapx, mapy, user_id 
        FROM tweet 
        LEFT JOIN (SELECT * FROM my_map WHERE user_id='${req.session.user_id}') AS my_map ON tweet.tweet_id=my_map.tweet_id
        WHERE tweet.tweet_id=?`;
    const [tweets] = await db.query(query, [id]);
    const [tweetUpdates] = await db.query('SELECT tweet_id FROM tweet_update WHERE tweet_id=?', [id]);
    const result = await T.get('statuses/show', {
        id, 
        include_entities: true,
        include_card_uri: false,
        tweet_mode: 'extended',
    }).catch(() => Promise.resolve({ data: { id: null } }));
    return res.render('tweet', { 
        req,
        title: _.get(tweets, '[0].name'),
        isUpdatePage: 0,
        isRegistered: tweets.length,
        hasUpdate: tweetUpdates.length,
        
        tweet: result.data,
        id, 
        name: _.get(tweets, '[0].name'),
        address: _.get(tweets, '[0].address'),
        roadAddress: _.get(tweets, '[0].road_address'),
        phone: _.get(tweets, '[0].phone'),
        mapx: _.get(tweets, '[0].mapx'),
        mapy: _.get(tweets, '[0].mapy'),

        isGabolga: _.get(tweets, '[0].user_id'),
    });
}));

// PUT /tweet/:id
// 등록
router.put('/:id', wrapAsync(async (req, res, next) => {
    if (!req.session.isLogin) {
        return res.status(400).send();
    }

    if (!(req.body.name && (req.body.address || req.body.road_address) && req.body.mapx && req.body.mapy)) {
        return res.status(400).send();
    }

    if (statusIdRegex.test(req.params.id)) {
        return res.redirect(301, `/tweet/${statusIdRegex.exec(req.params.id)[1]}`);
    }

    if (!idRegex.test(req.params.id)) {
        return res.status(400).send();
    }

    const tweetId = idRegex.exec(req.params.id)[1];
    const [rows] = await db.query('SELECT name FROM tweet WHERE tweet_id=?', [tweetId]);
    if (rows.length) {
        return res.status(400).send();
    }

    await db.query(`INSERT INTO tweet (tweet_id, name, address, road_address, phone, mapx, mapy, writer) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
    [tweetId, req.body.name, req.body.address, req.body.road_address, req.body.phone, req.body.mapx, req.body.mapy, req.session.user_id]);

    // 웹에서 등록 시에 가볼가 안 돼있으면 가볼가 하기
    await db.query('INSERT IGNORE INTO my_map (user_id, tweet_id) VALUES (?, ?)', [req.session.user_id, tweetId]);

    await postT.post('statuses/update', {
        status: `#가볼가 에 새로운 장소가 등록됐어요! 😆\n${req.body.name}\n${req.body.road_address || req.body.address}\nhttps://gabolga.gamjaa.com/tweet/${tweetId}\nhttps://twitter.com/i/status/${tweetId}`
    });

    await Mention.executeSendProcess(tweetId, req.session.user_id, req.body);

    const [users] = await db.query('SELECT oauth_token, oauth_token_secret, is_auto_tweet FROM users WHERE user_id=?', [req.session.user_id]);
    if (users[0].is_auto_tweet) {
        const T = getNewTwit(users[0].oauth_token, users[0].oauth_token_secret);
        await T.post('statuses/update', {
            status: `#가볼가 에 '${req.body.name}'을(를) 등록했어요! ✌\nhttps://gabolga.gamjaa.com/tweet/${tweetId}`
        });
    }

    const [alreadyGabolgas] = await db.query('SELECT user_id FROM my_map WHERE tweet_id=? AND user_id!=?', [tweetId, req.session.user_id]);
    alreadyGabolgas.forEach(async gabolga => {
        await sendDM(gabolga.user_id, {
            text: `🎉 가볼가 해두셨던 트윗에 장소가 등록됐어요.\n지금 확인해보세요!\nhttps://gabolga.gamjaa.com/tweet/${tweetId}`,
            ctas: [
                {
                    type: 'web_url',
                    label: '내 지도 보기',
                    url: `https://gabolga.gamjaa.com/my/map?tweet_id=${tweetId}`
                }
            ]
        });
    });
            
    await sendDM(req.session.user_id, {
        text: `등록해주셔서 감사해요! 😍\n${req.session.screen_name} 님의 지도에 '${req.body.name}'이(가) 기록됐어요!`,
        ctas: [
            {
                type: 'web_url',
                label: '내 지도 보기',
                url: `https://gabolga.gamjaa.com/my/map?tweet_id=${tweetId}`
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
    const [tweets] = await db.query(`SELECT name, address, road_address, phone, mapx, mapy, user_id 
    FROM tweet_update 
    LEFT JOIN my_map ON (tweet_update.tweet_id=my_map.tweet_id AND my_map.user_id=?)
    WHERE tweet_update.tweet_id=?`, [req.session.user_id, id]);
    const result = await T.get('statuses/show', {
        id, 
        include_entities: true,
        include_card_uri: false,
        tweet_mode: 'extended',
    }).catch(() => Promise.resolve({ data: { id: null } }));

    return res.render('tweet', { 
        req,
        title: '수정 요청',
        isUpdatePage: 1,
        isRegistered: tweets.length,
        hasUpdate: 1,
        
        tweet: result.data,
        id, 
        name: _.get(tweets, '[0].name'),
        address: _.get(tweets, '[0].address'),
        roadAddress: _.get(tweets, '[0].road_address'),
        phone: _.get(tweets, '[0].phone'),
        mapx: _.get(tweets, '[0].mapx'),
        mapy: _.get(tweets, '[0].mapy'),

        isGabolga: _.get(tweets, '[0].user_id'),
    });
}));

// POST /tweet/:id/update
// 수정 요청
router.post('/:id/update', wrapAsync(async (req, res, next) => {
    if (!req.session.isLogin) {
        return res.redirect(`/login?refer=${req.originalUrl}`);
    }

    if (!(req.body.name && (req.body.address || req.body.road_address) && req.body.mapx && req.body.mapy)) {
        return res.status(400).send();
    }

    await db.query(`INSERT IGNORE INTO tweet_update (tweet_id, name, address, road_address, phone, mapx, mapy, writer) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
    [req.params.id, req.body.name, req.body.address, req.body.road_address, req.body.phone, req.body.mapx, req.body.mapy, req.session.user_id]);

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
