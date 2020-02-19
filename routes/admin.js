const express = require('express');
const router = express.Router();
const db = require('./common/db');
const wrapAsync = require('./common/wrapAsync');
const getNewTwit = require('./common/twit');
const config = require('config');
const appT = require('./common/twit')();
const postBotConfig = config.get('bot.post');
const postT = new require('twit')(postBotConfig);
const Mention = require('./common/Mention');

const adminId = '62192325';

// GET /tweet
router.get('/tweet', wrapAsync(async (req, res, next) => {
    if (req.session.user_id !== adminId) {
        return res.status(403).send();
    }

    const [rows] = await db.query(`SELECT tweet_update.tweet_id, tweet.name AS old_name, tweet_update.name, road_address, address, phone FROM tweet_update
    LEFT JOIN (SELECT tweet_id, name FROM tweet) AS tweet ON tweet_update.tweet_id=tweet.tweet_id 
    ORDER BY write_time`);
    
    return res.render('tweetUpdateList', { 
        req,
        title: '수정 요청 목록',

        rows,
    });
}));

// PUT /tweet/:id
router.put('/tweet/:id', wrapAsync(async (req, res, next) => {
    if (req.session.user_id !== adminId) {
        return res.status(403).send();
    }

    const id = req.params.id;
    const [rows] = await db.query('SELECT * FROM tweet_update WHERE tweet_id=?', [id]);
    const row = rows[0];
    await db.query('UPDATE tweet SET name=?, address=?, road_address=?, phone=?, mapx=?, mapy=?, writer=?, write_time=? WHERE tweet_id=?',
        [row.name, row.address, row.road_address, row.phone, row.mapx, row.mapy, row.writer, row.write_time, id]);

    const deleteOldTweets = async () => {
        const {data} = await postT.get('search/tweets', {
            q: `from:gabolga_bot https://gabolga.gamjaa.com/tweet/${id}`,
            count: 100
        });
        data.statuses.forEach(async status => {
            await postT.post('statuses/destroy', {
                id: status.id_str
            });
        });
    };

    const timestamp = +new Date();
    await deleteOldTweets();
    await Mention.executeSendProcess(id, row.writer, row, timestamp);

    const [users] = await db.query('SELECT oauth_token, oauth_token_secret, is_auto_tweet FROM users WHERE user_id=?', [row.writer]);
    if (users[0].is_auto_tweet) {
        const T = getNewTwit(users[0].oauth_token, users[0].oauth_token_secret);
        await T.post('statuses/update', {
            status: `#가볼가 에 '${row.name}'을(를) 등록했어요! ✌\nhttps://gabolga.gamjaa.com/tweet/${id}?edited_at=${timestamp}`
        });
    }

    const [alreadyGabolgas] = await db.query('SELECT user_id FROM my_map WHERE tweet_id=? AND user_id!=?', [id, row.writer]);
    alreadyGabolgas.forEach(async gabolga => {
        await sendDM(gabolga.user_id, {
            text: `😮 앗! 가볼가 해두셨던 트윗의 장소 정보가 수정됐어요.\n지금 확인해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}?edited_at=${timestamp}`,
            ctas: [
                {
                    type: 'web_url',
                    label: '내 지도 보기',
                    url: `https://gabolga.gamjaa.com/my/map?tweet_id=${id}`
                }
            ]
        }).catch(() => Promise.resolve());
    });
            
    await sendDM(row.writer, {
        text: `감사합니다! 😍 수정해주신 장소 정보가 반영됐어요.\n지금 확인해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}?edited_at=${timestamp}`,
        ctas: [
            {
                type: 'web_url',
                label: '내 지도 보기',
                url: `https://gabolga.gamjaa.com/my/map?tweet_id=${id}`
            }
        ]
    }).catch(() => Promise.resolve());

    await db.query('DELETE FROM tweet_update WHERE tweet_id=?', [req.params.id]);

    return res.status(200).send();
}));

// DELETE /admin/tweet/:id
router.delete('/tweet/:id', wrapAsync(async (req, res, next) => {
    if (req.session.user_id !== adminId) {
        return res.status(403).send();
    }

    await db.query('DELETE FROM tweet_update WHERE tweet_id=?', [req.params.id]);

    return res.status(200).send();
}));

router.get('/mention-permission', wrapAsync(async (req, res, next) => {
    if (req.session.user_id !== adminId) {
        return res.status(403).send();
    }

    const screen_name = req.query.screen_name;
    const isDenied = req.query.is_denied ? true : false;

    const {data} = await appT.get('users/show', {
        screen_name
    });
    await Mention.setPermission(data.id_str, isDenied);

    if (!isDenied) {
        await Mention.sendMentionInQue(data.id_str);
    }

    return res.json({
        result: `${screen_name}(${data.id_str}) 님에게 멘션 ${isDenied ? '거부' : '허용'}`
    });
}));

router.get('/convert/:fromTo', wrapAsync(async (req, res, next) => {
    if (req.session.user_id !== adminId) {
        return res.status(403).send();
    }

    const [rows] = req.params.fromTo === 'wgs2naver'
        ? await db.query('SELECT * FROM tweet WHERE mapx IS NULL')
        : await db.query('SELECT * FROM tweet WHERE lat IS NULL');
    
    return res.render(req.params.fromTo, { 
        req,
        title: req.params.fromTo,

        rows: JSON.stringify(rows),
    });
}));

router.put('/convert/:fromTo/:id', wrapAsync(async (req, res, next) => {
    if (req.session.user_id !== adminId) {
        return res.status(403).send();
    }

    if (req.params.fromTo === 'wgs2naver') {
        await db.query('UPDATE tweet SET mapx=?, mapy=? WHERE tweet_id=?', [req.query.mapx, req.query.mapy, req.params.id]);
    } else {
        await db.query('UPDATE tweet SET lat=?, lng=? WHERE tweet_id=?', [req.query.lat, req.query.lng, req.params.id]);
    }

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