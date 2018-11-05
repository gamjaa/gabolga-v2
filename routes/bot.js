const express = require('express');
const router = express.Router();
const wrapAsync = require('./common/wrapAsync');
const _ = require('lodash');
const cryptojs = require('crypto-js');
const moment = require('moment');
const config = require('config');
const twit = require('twit');
const dmBotConfig = config.get('bot.dm');
const dmT = new twit(dmBotConfig);
const postBotConfig = config.get('bot.post');
const postT = new twit(postBotConfig);
const db = require('./common/db');
const localSearch = require('./common/localSearch');
const getNewTwit = require('./common/twit');

const statusIdRegex = /status\/([0-9]+)/;
const gabolgaRegex = /gabolga.gamjaa.com\/tweet\/([0-9]+)/;

// GET /webhook
router.get('/', (req, res, next) => {
    if (req.query.crc_token) {
        return res.json({
            response_token: `sha256=${cryptojs.enc.Base64.stringify(cryptojs.HmacSHA256(req.query.crc_token, dmBotConfig.consumer_secret))}`
        });
    }

    return res.status(403).send();
});

// POST /webhook
router.post('/', wrapAsync(async (req, res, next) => {
    const header = req.headers['x-twitter-webhooks-signature'];
    if (!header) {
        return res.status(403).send();
    }

    const headerCheck = `sha256=${cryptojs.enc.Base64.stringify(cryptojs.HmacSHA256(req.rawBody, dmBotConfig.consumer_secret))}`;
    if (header !== headerCheck) {
        return res.status(403).send();
    }
    
    // DM
    if (req.body.direct_message_events && 
        req.body.direct_message_events[0].message_create.sender_id !== '903176813517479936') {
        const senderId = req.body.direct_message_events[0].message_create.sender_id;
        const text = req.body.direct_message_events[0].message_create.message_data.text;

        await db.query('INSERT INTO dm (dm_id, user_id, text) VALUES (?, ?, ?)', 
            [req.body.direct_message_events[0].id, senderId, text]);

        const quickReply = _.get(req.body, 'direct_message_events[0].message_create.message_data.quick_reply_response.metadata');
        if (quickReply) {
            if (text === 'DM으로 바로 등록하기') {
                await db.query(`INSERT INTO users (user_id, search_tweet_id) 
                    VALUES (?, ?) 
                    ON DUPLICATE KEY UPDATE search_tweet_id=?`,
                [senderId, quickReply, quickReply]);

                await sendDM(senderId, {
                    text: `${req.body.users[senderId].name} 님, 검색 키워드를 전송해주세요! ex) 대전 은행동 성심당`,
                    quick_reply: {
                        type: 'options',
                        options: [
                            {
                                label: '등록 취소',
                                description: '등록 과정을 취소합니다',
                                metadata: `{"isClose": "${req.body.direct_message_events[0].id}"}`
                            }
                        ]
                    }
                });

                return res.status(200).send();
            }

            const {name, address, road_address, phone, mapx, mapy, isClose} = JSON.parse(quickReply);
            if (isClose) {
                await db.query('UPDATE users SET search_tweet_id=? WHERE user_id=?', [null, senderId]);

                await sendDM(senderId, {
                    text: '등록이 취소되었습니다. 나중에 웹으로도 등록하실 수 있습니다!'
                });

                return res.status(200).send();
            }

            const [users] = await db.query('SELECT oauth_token, oauth_token_secret, search_tweet_id, is_auto_tweet FROM users WHERE user_id=?', [senderId]);
            const tweetId = _.get(users, '[0].search_tweet_id');
            if (tweetId) {
                await db.query(`INSERT INTO tweet (tweet_id, name, address, road_address, phone, mapy, mapx, writer) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                [tweetId, name, address, road_address, phone, mapy, mapx, senderId]);
                
                await sendDM(senderId, {
                    text: `${req.body.users[senderId].name} 님의 지도에 '${name}'이(가) 등록되었습니다! 감사합니다.\nhttps://gabolga.gamjaa.com/tweet/${tweetId}`
                });
                
                const {data} = await postT.get('statuses/show', {
                    id: tweetId
                });
                const nowDate = moment();
                const tweetDate = moment(data.created_at, 'ddd MMM DD HH:mm:ss ZZ YYYY');  // Fri Jun 22 04:51:49 +0000 2018
                const durationDays = moment.duration(nowDate.diff(tweetDate)).asDays();
                if (data.retweet_count >= 1000 
                    || (durationDays <= 3 && data.retweet_count >= 20) || (durationDays <= 7 && data.retweet_count >= 100)) {
                    await postT.post('statuses/update', {
                        status: `@${data.user.screen_name} ${name}\n${road_address || address}\n#가볼가 에서 나만의 지도에 '${name}'를 기록해보세요!\nhttps://gabolga.gamjaa.com/tweet/${tweetId}`,
                        in_reply_to_status_id: tweetId
                    }).catch(err => console.log(err));
                }
                
                if (users[0].is_auto_tweet) {
                    const T = getNewTwit(users[0].oauth_token, users[0].oauth_token_secret);
                    await T.post('statuses/update', {
                        status: `#가볼가 에 '${name}'을(를) 등록했어요!\nhttps://gabolga.gamjaa.com/tweet/${tweetId}`
                    });
                }
                
                await db.query('UPDATE users SET search_tweet_id=? WHERE user_id=?', [null, senderId]);
                
                return res.status(200).send();
            }
        }

        const url = _.get(req.body, 'direct_message_events[0].message_create.message_data.entities.urls[0].expanded_url');
        const getIdFromUrl = url => {
            if (!url) {
                return null;
            }

            if (statusIdRegex.test(url)) {
                return statusIdRegex.exec(url)[1];
            }

            if (gabolgaRegex.test(url)) {
                return gabolgaRegex.exec(url)[1];
            }

            return null;
        };
        const id = getIdFromUrl(url);
        if (!id) {
            const [user] = await db.query('SELECT search_tweet_id FROM users WHERE user_id=?', [senderId]);

            if (!user.length || !user[0].search_tweet_id) {
                await sendDM(senderId, {
                    text: '궁금한 점이나 건의할 사항이 있으시다면 멘션이나 @_gamjaa로 DM 보내주세요! 감사합니다.',
                    ctas: [
                        {
                            type: 'web_url',
                            label: '멘션 보내기',
                            url: 'https://twitter.com/intent/tweet?text=@GABOLGA_bot%20'
                        },
                        {
                            type: 'web_url',
                            label: '@_gamjaa로 DM 보내기',
                            url: 'https://twitter.com/messages/compose?recipient_id=62192325'
                        },
                    ]
                });
    
                return res.status(200).send();
            }

            const {items} = await localSearch(text);
            const places = items.map(item => {
                const {name, address, road_address, phone, mapx, mapy} = item;
                return {
                    label: name,
                    description: `${address || road_address} / ${phone}`,
                    metadata: JSON.stringify({name, address, road_address, phone, mapx, mapy})
                };
            });
            await sendDM(senderId, {
                text: places.length 
                    ? '검색된 장소들입니다. 원하는 장소를 선택해주세요. 다른 키워드로 다시 검색할 수도 있습니다.'
                    : '검색 결과가 없습니다. 다른 키워드로 다시 검색해주세요.',
                quick_reply: {
                    type: 'options',
                    options: [
                        ...places,
                        {
                            label: '등록 취소',
                            description: '등록 과정을 취소합니다',
                            metadata: `{"isClose": "${req.body.direct_message_events[0].id}"}`
                        }
                    ]
                }
            });

            return res.status(200).send();
        }

        const [rows] = await db.query('SELECT name FROM tweet WHERE tweet_id=?', [id]);

        await db.query('INSERT IGNORE INTO my_map (user_id, tweet_id) VALUES (?, ?)',
            [senderId, id]);
    
        if (rows.length) {
            await sendDM(senderId, {
                text: `${req.body.users[senderId].name} 님의 지도에 '${rows[0].name}'이(가) 등록되었습니다. 확인해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}`
            });
        } else {
            await sendDM(senderId, {
                text: `아직 가볼가에 등록되지 않은 트윗이에요. ${req.body.users[senderId].name} 님께서 직접 등록해보는 건 어떨까요? DM으로 바로 등록할 수도 있습니다.`,
                ctas: [
                    {
                        type: 'web_url',
                        label: '사이트에서 등록하기',
                        url: `https://gabolga.gamjaa.com/tweet/${id}?unregistered`
                    },
                ],
                quick_reply: {
                    type: 'options',
                    options: [
                        {
                            label: 'DM으로 바로 등록하기',
                            description: '(추천) 현재 화면에서 대화하듯이 등록할 수 있습니다.',
                            metadata: id
                        }
                    ]
                }
            });
        }


        return res.status(200).send();
    }

    // Follow
    if (req.body.follow_events &&
        req.body.follow_events[0].source.id !== '903176813517479936') {
        await sendDM(req.body.follow_events[0].source.id, {
            text: `반갑습니다, ${req.body.follow_events[0].source.name} 님! 팔로우 해주셔서 감사합니다.\n가볼까 하는 장소가 적힌 트윗을 DM으로 보내주세요! ${req.body.follow_events[0].source.name} 님의 지도에 기록해드릴게요.`
        });
        
        return res.status(200).send();
    }

    return res.status(200).send();
}));

module.exports = router;

async function sendDM(target_id, message_data) {
    return dmT.post('direct_messages/events/new', {
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
