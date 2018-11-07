const express = require('express');
const router = express.Router();
const _ = require('lodash');
const moment = require('moment');
const db = require('./common/db');
const wrapAsync = require('./common/wrapAsync');
const getNewTwit = require('./common/twit');
const config = require('config');
const postBotConfig = config.get('bot.post');
const postT = new require('twit')(postBotConfig);
const mentionDeniedUsers = config.get('mention_denied_users');

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
        LEFT JOIN my_map ON (tweet.tweet_id=my_map.tweet_id AND my_map.user_id='${req.session.user_id}')
        WHERE tweet.tweet_id=?`;
    const [rows] = await db.query(query, [id]);
    const T = getNewTwit();
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
        mapx: _.get(rows, '[0].mapx'),
        mapy: _.get(rows, '[0].mapy'),

        isGabolga: _.get(rows, '[0].user_id'),
    });
}));

// PUT /tweet/:id
// 등록 및 수정 요청
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

    const id = idRegex.exec(req.params.id)[1];
    const [rows] = await db.query('SELECT name FROM tweet WHERE tweet_id=?', [id]);
    if (rows.length) {
        return res.status(400).send();
    }

    await db.query(`INSERT INTO tweet (tweet_id, name, address, road_address, phone, mapx, mapy, writer) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
    [id, req.body.name, req.body.address, req.body.road_address, req.body.phone, req.body.mapx, req.body.mapy, req.session.user_id]);

    const {data} = await postT.get('statuses/show', {
        id
    });
    const isSendMention = ({user, retweet_count, created_at}) => {
        if (user.id_str === req.session.user_id) {
            return true;
        }
        
        if (mentionDeniedUsers.includes(user.id_str)) {
            return false;
        }
        
        const nowDate = moment();
        const tweetDate = moment(created_at, 'ddd MMM DD HH:mm:ss ZZ YYYY');  // Fri Jun 22 04:51:49 +0000 2018
        const durationDays = moment.duration(nowDate.diff(tweetDate)).asDays();

        return retweet_count >= 1000 
            || (durationDays <= 3 && retweet_count >= 20) || (durationDays <= 7 && retweet_count >= 100);
    };
    if (isSendMention(data)) {
        await postT.post('statuses/update', {
            status: `@${data.user.screen_name} ${req.body.name}\n${req.body.road_address || req.body.address}\n#가볼가 에서 나만의 지도에 '${req.body.name}'을(를) 기록해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}`,
            in_reply_to_status_id: id
        }).catch(err => Promise.resolve(console.log(err)));
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
            text: `가볼가 해두셨던 트윗에 장소가 등록됐어요. 지금 확인해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}`
        });
    });
            
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
