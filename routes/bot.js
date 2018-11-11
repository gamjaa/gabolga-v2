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
const appT = getNewTwit();
const telegramSend = require('./telegram');

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
    
    // Favorite
    if (_.get(req.body, 'favorite_events[0].favorited_status.user.id_str') === '903176813517479936') {
        const url = _.get(req.body, 'favorite_events[0].favorited_status.entities.urls[0].expanded_url');
        if (!gabolgaRegex.test(url)) {
            return res.status(200).send();
        }
        
        const userId = req.body.favorite_events[0].user.id_str;
        const id = gabolgaRegex.exec(url)[1];
        const [users] = await db.query('SELECT user_id FROM users WHERE user_id=?', [userId]);
        if (!users.length) {
            await db.query('INSERT IGNORE INTO my_map (user_id, tweet_id) VALUES (?, ?)',
                [userId, id]);
            return res.status(200).send();
        }

        const [myMaps] = await db.query('SELECT tweet_id FROM my_map WHERE user_id=? AND tweet_id=?', [userId, id]);
        if (myMaps.length) {
            return res.status(200).send();
        }

        await db.query('INSERT INTO my_map (user_id, tweet_id) VALUES (?, ?)',
            [userId, id]);

        const [rows] = await db.query('SELECT name FROM tweet WHERE tweet_id=?', [id]);
        await sendDM(userId, {
            text: `${req.body.favorite_events[0].user.name} 님의 지도에 '${rows[0].name}'이(가) 등록되었습니다. 확인해보세요!`,
            ctas: [
                {
                    type: 'web_url',
                    label: '내 지도 보기',
                    url: `https://gabolga.gamjaa.com/my/map?tweet_id=${id}`
                }
            ]
        }).catch((err) => Promise.resolve(console.log(err.stack)));
        
        return res.status(200).send();
    }

    // RT
    if (_.get(req.body, 'tweet_create_events[0].retweeted_status.user.id_str') === '903176813517479936') {
        const url = _.get(req.body, 'tweet_create_events[0].retweeted_status.entities.urls[0].expanded_url');
        if (!gabolgaRegex.test(url)) {
            return res.status(200).send();
        }
        
        const userId = req.body.tweet_create_events[0].user.id_str;
        const id = gabolgaRegex.exec(url)[1];
        const [users] = await db.query('SELECT user_id FROM users WHERE user_id=?', [userId]);
        if (!users.length) {
            await db.query('INSERT IGNORE INTO my_map (user_id, tweet_id) VALUES (?, ?)',
                [userId, id]);
            return res.status(200).send();
        }

        const [myMaps] = await db.query('SELECT tweet_id FROM my_map WHERE user_id=? AND tweet_id=?', [userId, id]);
        if (myMaps.length) {
            return res.status(200).send();
        }

        await db.query('INSERT INTO my_map (user_id, tweet_id) VALUES (?, ?)',
            [userId, id]);

        const [rows] = await db.query('SELECT name FROM tweet WHERE tweet_id=?', [id]);
        await sendDM(userId, {
            text: `${req.body.tweet_create_events[0].user.name} 님의 지도에 '${rows[0].name}'이(가) 등록되었습니다. 확인해보세요!`,
            ctas: [
                {
                    type: 'web_url',
                    label: '내 지도 보기',
                    url: `https://gabolga.gamjaa.com/my/map?tweet_id=${id}`
                }
            ]
        }).catch(() => Promise.resolve());

        return res.status(200).send();
    }

    // DM
    if (req.body.direct_message_events && 
        req.body.direct_message_events[0].message_create.sender_id !== '903176813517479936') {
        const senderId = req.body.direct_message_events[0].message_create.sender_id;
        const text = req.body.direct_message_events[0].message_create.message_data.text;

        await db.query('INSERT INTO dm (dm_id, user_id, text) VALUES (?, ?, ?)', 
            [req.body.direct_message_events[0].id, senderId, text]);

        const setMentionPermission = async (userId, isDenied) => {
            await db.query(`INSERT INTO mention_permission (user_id, is_denied) 
            VALUES (?, ?) 
            ON DUPLICATE KEY UPDATE is_denied=?`, [userId, isDenied, isDenied]);
        };
        if (/멘션\s?거부/.test(text)) {
            await setMentionPermission(senderId, true);
            await sendDM(senderId, {
                text: `불편을 드려 죄송합니다. 최근 7일간 ${req.body.users[senderId].name} 님 트윗에 달렸던 답글을 삭제하고, 앞으로 답글이 달리지 않도록 처리하겠습니다.\n혹시 생각이 바뀌신다면 언제든지 "멘션허락"이라고 보내주시면 됩니다.\n다시 한 번 죄송하다는 말씀드리며, 좋은 하루 보내시길 바랍니다. 감사합니다.`,
                quick_reply: {
                    type: 'options',
                    options: [
                        {
                            label: '멘션허락',
                            description: '답글이 달리는 것을 허락합니다',
                            metadata: req.body.direct_message_events[0].id
                        }
                    ]
                }
            });
            const {data} = await postT.get('search/tweets', {
                q: `from:gabolga_bot to:${req.body.users[senderId].screen_name} #가볼가`,
                count: 100
            });
            data.statuses.forEach(async status => {
                await postT.post('statuses/destroy', {
                    id: status.id_str
                });
            });

            return res.status(200).send();
        }

        if (/멘션\s?허락/.test(text)) {
            await setMentionPermission(senderId, false);
            await sendDM(senderId, {
                text: `허락해주셔서 감사합니다, ${req.body.users[senderId].name} 님!\n혹시 생각이 바뀌신다면 언제든지 "멘션거부"라고 보내주시면 됩니다. 불편하게 느끼시지 않도록 노력하겠습니다.\n좋은 하루 보내시길 바랍니다.`,
                quick_reply: {
                    type: 'options',
                    options: [
                        {
                            label: '멘션거부',
                            description: '답글이 달리는 것을 거부합니다',
                            metadata: req.body.direct_message_events[0].id
                        }
                    ]
                }
            });

            return res.status(200).send();
        }

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
                    text: `${req.body.users[senderId].name} 님의 지도에 '${name}'이(가) 등록되었습니다! 감사합니다.`,
                    ctas: [
                        {
                            type: 'web_url',
                            label: '내 지도 보기',
                            url: `https://gabolga.gamjaa.com/my/map?tweet_id=${tweetId}`
                        }
                    ]
                });
                
                if (users[0].is_auto_tweet) {
                    const T = getNewTwit(users[0].oauth_token, users[0].oauth_token_secret);
                    await T.post('statuses/update', {
                        status: `#가볼가 에 '${name}'을(를) 등록했어요!\nhttps://gabolga.gamjaa.com/tweet/${tweetId}`
                    });
                }
                
                await db.query('UPDATE users SET search_tweet_id=? WHERE user_id=?', [null, senderId]);

                const {data} = await appT.get('statuses/show', {
                    id: tweetId
                });
                const [mentionPermission] = await db.query('SELECT * FROM mention_permission WHERE user_id=?', [data.user.id_str]);
                const isDenied = _.get(mentionPermission, '[0].is_denied');
                const isSendMention = ({user, retweet_count, created_at}) => {
                    if (user.id_str === senderId) {
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
                if (isSendMention(data)) {
                    if (!mentionPermission.length) {
                        await setMentionPermission(data.user.id_str, null);
                        await sendDM(data.user.id_str, {
                            text: `안녕하세요, ${data.user.name} 님.\n${data.user.name} 님께서 올리신 트윗과 관련된 장소를 해당 트윗 답글로 달았습니다. 주소 공유 측면과 함께 홍보성도 띄고 있어서 허락을 구하고자 메시지 드립니다.\n가볼가는 트위터 맛집 등을 편하게 찾아가고자 만든 비영리 사이트입니다. 답글이 달리는 것을 원치 않으시다면 "멘션거부"라고 DM 부탁드립니다.\n좋은 하루 보내시길 바랍니다. 감사합니다.`,
                            quick_reply: {
                                type: 'options',
                                options: [
                                    {
                                        label: '멘션허락',
                                        description: '답글이 달리는 것을 허락합니다',
                                        metadata: 1
                                    },
                                    {
                                        label: '멘션거부',
                                        description: '답글이 달리는 것을 거부합니다',
                                        metadata: 0
                                    }
                                ]
                            }
                        }).catch(async () => {
                            return Promise.resolve(await postT.post('statuses/update', {
                                status: `@${data.user.screen_name} 안녕하세요. 작성하신 트윗과 관련된 장소를 답글로 달았습니다. 주소 공유 측면과 함께 홍보성도 있어서 허락을 구하고자 연락 드립니다.\n가볼가는 트위터 맛집 등을 편하게 찾아가고자 만든 비영리 사이트입니다. 답글을 원치 않으시면 "멘션거부"라고 DM 부탁드립니다.\n감사합니다`
                            }));
                        }).catch(async () => Promise.resolve(await setMentionPermission(data.user.id_str, true)));
                    }

                    await postT.post('statuses/update', {
                        status: `@${data.user.screen_name} ${name}\n${road_address || address}\n#가볼가 에서 나만의 지도에 '${name}'을(를) 기록해보세요!\nhttps://gabolga.gamjaa.com/tweet/${tweetId}`,
                        in_reply_to_status_id: tweetId
                    }).catch(async () => Promise.resolve(await setMentionPermission(data.user.id_str, true)));
                }

                const [alreadyGabolgas] = await db.query('SELECT user_id FROM my_map WHERE tweet_id=? AND user_id!=?', [tweetId, senderId]);
                alreadyGabolgas.forEach(async gabolga => {
                    await sendDM(gabolga.user_id, {
                        text: `가볼가 해두셨던 트윗에 장소가 등록됐어요. 지금 확인해보세요!\nhttps://gabolga.gamjaa.com/tweet/${tweetId}`,
                        ctas: [
                            {
                                type: 'web_url',
                                label: '내 지도 보기',
                                url: `https://gabolga.gamjaa.com/my/map?tweet_id=${tweetId}`
                            }
                        ]
                    });
                });
                
                return res.status(200).send();
            }
        }

        const url = _.get(req.body, 'direct_message_events[0].message_create.message_data.entities.urls[0].expanded_url');
        const getIdFromUrlAsync = async url => {
            if (!url) {
                return null;
            }

            if (statusIdRegex.test(url)) {
                const id = statusIdRegex.exec(url)[1];
                const {data} = await appT.get('statuses/show', {
                    id,
                    include_entities: true
                });
                const urlInTweet = _.get(data, 'entities.urls[0].expanded_url');

                return urlInTweet && gabolgaRegex.test(urlInTweet) ? gabolgaRegex.exec(urlInTweet)[1] : id;
            }

            if (gabolgaRegex.test(url)) {
                return gabolgaRegex.exec(url)[1];
            }

            return null;
        };
        const id = await getIdFromUrlAsync(url);
        if (!id) {
            const [user] = await db.query('SELECT search_tweet_id FROM users WHERE user_id=?', [senderId]);

            if (!user.length || !user[0].search_tweet_id) {
                await sendDM(senderId, {
                    text: '궁금한 점이나 건의할 사항이 있으시다면 멘션이나 @_gamjaa로 DM 보내주세요! 감사합니다.',
                    ctas: [
                        {
                            type: 'web_url',
                            label: '가볼가 사용법',
                            url: 'https://gabolga.gamjaa.com/guide'
                        },
                        {
                            type: 'web_url',
                            label: `가볼가 검색: ${text}`,
                            url: `https://gabolga.gamjaa.com/search?q=${encodeURI(text)}`
                        },
                        {
                            type: 'web_url',
                            label: '@_gamjaa로 DM 보내기',
                            url: 'https://twitter.com/messages/compose?recipient_id=62192325'
                        },
                    ]
                });

                await telegramSend(`@${req.body.users[senderId].screen_name}`, text);
    
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
        const userId = req.body.follow_events[0].source.id;
        const screenName = req.body.follow_events[0].source.screen_name;
        const name = req.body.follow_events[0].source.name;

        await db.query(`INSERT INTO users (user_id, screen_name) 
        VALUES (?, ?) 
        ON DUPLICATE KEY UPDATE screen_name=?`, 
        [userId, screenName, screenName]);

        await sendDM(userId, {
            text: `반갑습니다, ${name} 님! 팔로우 해주셔서 감사합니다.\n가볼까 하는 장소가 적힌 트윗을 DM으로 보내주세요! ${name} 님의 지도에 기록해드릴게요.`
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
