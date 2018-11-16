const express = require('express');
const router = express.Router();
const _ = require('lodash');
const moment = require('moment');
const db = require('./common/db');
const wrapAsync = require('./common/wrapAsync');
const getNewTwit = require('./common/twit');
const config = require('config');
const appT = require('./common/twit')();
const postBotConfig = config.get('bot.post');
const postT = new require('twit')(postBotConfig);

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
    await db.query('UPDATE tweet SET name=?, address=?, road_address=?, phone=?, lat=?, lng=?, writer=?, write_time=? WHERE tweet_id=?',
        [row.name, row.address, row.road_address, row.phone, row.lat, row.lng, row.writer, row.write_time, id]);

    const {data} = await appT.get('statuses/show', {
        id
    });
    const [mentionPermission] = await db.query('SELECT * FROM mention_permission WHERE user_id=?', [data.user.id_str]);
    const isDenied = _.get(mentionPermission, '[0].is_denied');
    const isSendMention = ({user, retweet_count, created_at}) => {
        if (user.id_str === row.writer) {
            return true;
        }
        
        if (isDenied) {
            return false;
        }
        
        const nowDate = moment();
        const tweetDate = moment(created_at, 'ddd MMM DD HH:mm:ss ZZ YYYY');  // Fri Jun 22 04:51:49 +0000 2018
        const durationDays = moment.duration(nowDate.diff(tweetDate)).asDays();

        return retweet_count >= 1000 
            || (durationDays <= 3 && retweet_count >= 20) || (durationDays <= 7 && retweet_count >= 100);
    };

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
    if (isSendMention(data)) {
        await deleteOldTweets();

        const setMentionPermission = async (userId, isDenied) => {
            await db.query(`INSERT INTO mention_permission (user_id, is_denied) 
            VALUES (?, ?) 
            ON DUPLICATE KEY UPDATE is_denied=?`, [userId, isDenied, isDenied]);
        };

        await postT.post('statuses/update', {
            status: `@${data.user.screen_name} ${row.name}\n${row.road_address || row.address}\n#가볼가 에서 나만의 지도에 '${row.name}'을(를) 기록해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}#${timestamp}`,
            in_reply_to_status_id: id
        }).catch(async () => Promise.resolve(await setMentionPermission(data.user.id_str, true)));
    }

    const [users] = await db.query('SELECT oauth_token, oauth_token_secret, is_auto_tweet FROM users WHERE user_id=?', [row.writer]);
    if (users[0].is_auto_tweet) {
        const T = getNewTwit(users[0].oauth_token, users[0].oauth_token_secret);
        await T.post('statuses/update', {
            status: `#가볼가 에 '${row.name}'을(를) 등록했어요!\nhttps://gabolga.gamjaa.com/tweet/${id}#${timestamp}`
        });
    }

    const [alreadyGabolgas] = await db.query('SELECT user_id FROM my_map WHERE tweet_id=? AND user_id!=?', [id, row.writer]);
    alreadyGabolgas.forEach(async gabolga => {
        await sendDM(gabolga.user_id, {
            text: `가볼가 해두셨던 트윗의 장소 정보가 수정됐어요. 지금 확인해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}#${timestamp}`,
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
        text: `감사합니다! 수정해주신 장소 정보가 반영되었습니다! 지금 확인해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}#${timestamp}`,
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