const express = require('express');
const router = express.Router();
const wrapAsync = require('./common/wrapAsync');
const _ = require('lodash');
const cryptojs = require('crypto-js');
const config = require('config');
const twit = require('twit');
const postBotConfig = config.get('bot.post');
const dmBotConfig = config.get('bot.dm');
const postT = new twit(postBotConfig);
const db = require('./common/db');
const localSearch = require('./common/localSearch');
const getNewTwit = require('./common/twit');
const appT = getNewTwit();
const sendDM = require('./common/sendDmAsync');
const telegramSend = require('./common/telegram');
const Mention = require('./common/Mention');

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
    
    const gabolgaAsync = async (url, eventObject) => {
        if (!gabolgaRegex.test(url)) {
            return res.status(200).send();
        }
        
        const userId = eventObject.user.id_str;
        const tweetId = gabolgaRegex.exec(url)[1];
        const [users] = await db.query('SELECT user_id FROM users WHERE user_id=?', [userId]);
        if (!users.length) {
            await db.query('INSERT IGNORE INTO my_map (user_id, tweet_id) VALUES (?, ?)',
                [userId, tweetId]);
            return res.status(200).send();
        }

        const [myMaps] = await db.query('SELECT tweet_id FROM my_map WHERE user_id=? AND tweet_id=?', [userId, tweetId]);
        if (myMaps.length) {
            return res.status(200).send();
        }

        await db.query('INSERT INTO my_map (user_id, tweet_id) VALUES (?, ?)',
            [userId, tweetId]);

        const [rows] = await db.query('SELECT name FROM tweet WHERE tweet_id=?', [tweetId]);
        await sendDM(userId, {
            text: `🎉 ${eventObject.user.name} 님의 지도에 '${rows[0].name}'이(가) 기록됐어요.\n확인해보세요! 💨💨💨`,
            ctas: [
                {
                    type: 'web_url',
                    label: '내 지도 보기',
                    url: `https://gabolga.gamjaa.com/my/map?tweet_id=${tweetId}`
                }
            ]
        }).catch((err) => Promise.resolve(console.log(err.stack)));
        
        return res.status(200).send();
    };

    // Favorite
    if (_.get(req.body, 'favorite_events[0].favorited_status.user.id_str') === '903176813517479936') {
        const url = _.get(req.body, 'favorite_events[0].favorited_status.entities.urls[0].expanded_url');
        return await gabolgaAsync(url, req.body.favorite_events[0]);
    }

    // RT
    if (_.get(req.body, 'tweet_create_events[0].retweeted_status.user.id_str') === '903176813517479936') {
        const url = _.get(req.body, 'tweet_create_events[0].retweeted_status.entities.urls[0].expanded_url');
        return await gabolgaAsync(url, req.body.tweet_create_events[0]);
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
                    text: `${req.body.users[senderId].name} 님, 검색 키워드를 전송해주세요! 🔍\n장소명은 띄어쓰기 없이 붙여주세요.\n예시) 성심당, 중앙로역 성심당, 은행동 성심당`,
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
                    text: '등록 과정이 취소됐어요. 😦\n나중에 웹으로도 등록하실 수 있답니다!\n해당 트윗을 다시 보내시면 등록 과정을 재시작할 수 있어요.'
                });

                return res.status(200).send();
            }

            const [users] = await db.query('SELECT oauth_token, oauth_token_secret, search_tweet_id, is_auto_tweet FROM users WHERE user_id=?', [senderId]);
            const tweetId = _.get(users, '[0].search_tweet_id');
            if (tweetId) {
                await db.query(`INSERT IGNORE INTO tweet (tweet_id, name, address, road_address, phone, mapx, mapy, writer) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                [tweetId, name, address, road_address, phone, mapx, mapy, senderId]);
                
                await sendDM(senderId, {
                    text: `등록해주셔서 감사해요! 😍\n${req.body.users[senderId].name} 님의 지도에 '${name}'이(가) 기록됐어요.`,
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
                        status: `#가볼가 에 '${name}'을(를) 등록했어요! ✌\nhttps://gabolga.gamjaa.com/tweet/${tweetId}`
                    });
                }
                
                await db.query('UPDATE users SET search_tweet_id=? WHERE user_id=?', [null, senderId]);

                await Mention.executeSendProcess(tweetId, senderId, {
                    name, address, road_address
                });

                const [alreadyGabolgas] = await db.query('SELECT user_id FROM my_map WHERE tweet_id=? AND user_id!=?', [tweetId, senderId]);
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

            if (user.length && user[0].search_tweet_id) {
                // 검색어
                const {items} = await localSearch(text);
                const places = items.map(item => {
                    const {name, address, road_address, phone, mapx, mapy} = item;
                    return {
                        label: name,
                        description: `${address || road_address} / ${phone}`,
                        metadata: JSON.stringify({name, address, road_address, phone, mapx, mapy})
                    };
                });
                await db.query('INSERT INTO search_log(tweet_id, keyword) VALUES (?, ?)', [user[0].search_tweet_id, text]);
                await sendDM(senderId, {
                    text: places.length 
                        ? `'${text}'(으)로 검색된 장소들이에요. 🧐\n원하는 장소를 선택해주세요. 다른 키워드로 다시 검색할 수도 있답니다.\n장소 목록이 안 보인다면, 화면 하단의 ☰ 버튼을 눌러주세요.`
                        : `'${text}'에 대한 검색 결과가 없어요. 😢\n다른 키워드로 다시 검색해주세요. 지역명(구, 동)을 빼고 장소명만으로도 검색해보세요!`,
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

            await telegramSend([`@${req.body.users[senderId].screen_name}`, text], true);

            const noSpaceText = text.replace(/\s/g, '');
                
            if (/거부|거절|달지|안달|안다|불허|원치|원하지|허락하지/.test(noSpaceText)) {
                // 거부 메시지
                await Mention.setPermission(senderId, true);
                await sendDM(senderId, {
                    text: '답변해주셔서 감사합니다. 거부 처리 완료되었습니다.\n혹시 생각이 바뀌신다면 언제든지 "멘션허용"이라고 보내주시면 됩니다. 감사합니다.',
                    quick_reply: {
                        type: 'options',
                        options: [
                            {
                                label: '멘션허용',
                                description: '답글이 달리는 것을 허용합니다',
                                metadata: senderId
                            }
                        ]
                    }
                });
    
                return res.status(200).send();
            }
    
            if (/허용|허락|다셔도|달아도|괜찮|상관없/.test(noSpaceText)) {
                // 허용 메시지
                await Mention.setPermission(senderId, false);
                await sendDM(senderId, {
                    text: `허락해주셔서 감사합니다, ${req.body.users[senderId].name} 님! 😍\n혹시 생각이 바뀌신다면 언제든지 "멘션거부"라고 보내주시면 됩니다. 불편하게 느끼시지 않도록 노력하겠습니다.\n좋은 하루 보내시길 바랍니다.`,
                    quick_reply: {
                        type: 'options',
                        options: [
                            {
                                label: '멘션거부',
                                description: '답글이 달리는 것을 거부합니다',
                                metadata: senderId
                            }
                        ]
                    }
                });
                await Mention.sendMentionInQue(senderId);
    
                return res.status(200).send();
            }

            // 그 외
            const q = text.replace(/[.~!*()'"]/g, '');
            const searchBtnLabel = `가볼가 검색: ${q}`;
            await sendDM(senderId, {
                text: `문의 및 건의사항은 멘션이나 @_gamjaa(DM)로 보내주세요. 😉\n사용법이 궁금하시거나, 가볼가에서 '${q}'(으)로 검색하시려면 아래 버튼을 눌러주세요! 감사합니다.`,
                ctas: [
                    {
                        type: 'web_url',
                        label: '가볼가 사용법',
                        url: 'https://gabolga.gamjaa.com/guide'
                    },
                    {
                        type: 'web_url',
                        label: (searchBtnLabel.length > 36 ? `${searchBtnLabel.slice(0, 33)}...` : searchBtnLabel),
                        url: `https://gabolga.gamjaa.com/search?q=${encodeURIComponent(q)}`
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

        const [rows] = await db.query('SELECT name FROM tweet WHERE tweet_id=?', [id]);

        await db.query('INSERT IGNORE INTO my_map (user_id, tweet_id) VALUES (?, ?)',
            [senderId, id]);
    
        if (rows.length) {
            await sendDM(senderId, {
                text: `🎉 ${req.body.users[senderId].name} 님의 지도에 '${rows[0].name}'이(가) 기록됐어요.\n확인해보세요! 💨💨💨`,
                ctas: [
                    {
                        type: 'web_url',
                        label: '내 지도 보기',
                        url: `https://gabolga.gamjaa.com/my/map?tweet_id=${id}`
                    }
                ]
            });
        } else {
            await sendDM(senderId, {
                text: `아직 가볼가에 등록되지 않은 트윗이에요. 😮\n${req.body.users[senderId].name} 님께서 직접 등록해보는 건 어떨까요?\n화면 하단의 'DM으로 바로 등록하기'를 눌러 DM으로 등록할 수도 있어요. 버튼이 안 보인다면, ☰ 버튼을 눌러주세요.`,
                ctas: [
                    {
                        type: 'web_url',
                        label: '사이트에서 등록하기',
                        url: `https://gabolga.gamjaa.com/tweet/${id}`
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

    // Mention
    if (_.get(req.body, 'tweet_create_events[0].in_reply_to_user_id_str') === '903176813517479936') {
        const eventObject = req.body.tweet_create_events[0];

        if (!eventObject.in_reply_to_status_id_str) {
            // 일반 멘션 무시
            return res.status(200).send();
        }

        const parentTweet = await appT.get('statuses/show', {
            id: eventObject.in_reply_to_status_id_str,
            tweet_mode: 'extended',
        });

        if (!parentTweet.data.full_text.includes('멘션거부')) {
            // 멘션허락, 거부 답글 이외 무시
            return res.status(200).send();
        }

        const senderId = eventObject.user.id_str;
        const noSpaceText = eventObject.text.replace(/\s/g, '');

        if (/거부|거절|달지|안달|안다|불허|원치|원하지|허락하지/.test(noSpaceText)) {
            // 거절 멘션
            await Mention.setPermission(senderId, true);
            await postT.post('statuses/update', {
                status: `@${eventObject.user.screen_name} 답변해주셔서 감사합니다. 거부 처리 완료되었습니다.\n혹시 생각이 바뀌신다면 언제든지 "멘션허용"이라고 보내주시면 됩니다. 감사합니다.`,
                in_reply_to_status_id: eventObject.id_str
            });

            return res.status(200).send();
        }

        if (/허용|허락|다셔도|달아도|괜찮|상관없/.test(noSpaceText)) {
            // 허용 멘션
            await Mention.setPermission(senderId, false);
            await postT.post('statuses/update', {
                status: `@${eventObject.user.screen_name} 허락해주셔서 감사합니다!\n혹시 생각이 바뀌신다면 언제든지 "멘션거부"라고 보내주시면 됩니다. 불편하게 느끼시지 않도록 노력하겠습니다.\n좋은 하루 보내시길 바랍니다.`,
                in_reply_to_status_id: eventObject.id_str
            });
            await Mention.sendMentionInQue(senderId);

            return res.status(200).send();
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
            text: `반가워요, ${name} 님! 🤗 팔로우 해주셔서 감사합니다.\n가볼까 하는 장소가 있는 트윗을 DM으로 보내주세요! ${name} 님의 지도에 기록해드릴게요.`,
            ctas: [
                {
                    type: 'web_url',
                    label: '가볼가 사용법',
                    url: 'https://gabolga.gamjaa.com/guide'
                },
                {
                    type: 'web_url',
                    label: `${screenName} 님의 지도`,
                    url: 'https://gabolga.gamjaa.com/my/map'
                }
            ]
        });
        
        const gabolgaCount = (await db.query('SELECT count(*) AS count FROM my_map WHERE user_id=?', [userId]))[0][0].count;
        if (gabolgaCount) {
            await sendDM(userId, {
                text: `앗! 이미 가볼가 하신 트윗이 ${gabolgaCount}개 있네요! 👍\n얼른 확인하러 가볼까요? 💨💨💨`,
                ctas: [
                    {
                        type: 'web_url',
                        label: `${screenName} 님의 지도`,
                        url: 'https://gabolga.gamjaa.com/my/map'
                    }
                ]
            });
        }
        
        return res.status(200).send();
    }

    return res.status(200).send();
}));

module.exports = router;


