const express = require('express');
const router = express.Router();
const wrapAsync = require('./common/wrapAsync');
const _ = require('lodash');
const cryptojs = require('crypto-js');
const twit = require('twit');
const botConfig = require('config').get('bot');
const T = new twit(botConfig);
const db = require('./common/db');
const localSearch = require('./common/localSearch');

const statusIdRegex = /status\/([0-9]+)/;

// GET /webhook
router.get('/', (req, res, next) => {
    if (req.query.crc_token) {
        return res.json({
            response_token: `sha256=${cryptojs.enc.Base64.stringify(cryptojs.HmacSHA256(req.query.crc_token, botConfig.consumer_secret))}`
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

    const headerCheck = `sha256=${cryptojs.enc.Base64.stringify(cryptojs.HmacSHA256(req.rawBody, botConfig.consumer_secret))}`;
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
                await db.query('UPDATE users SET search_tweet_id=? WHERE user_id=?', [quickReply, senderId]);

                await sendDM(senderId, {
                    text: '검색 키워드를 전송해주세요. ex) 은행동 성심당'
                });

                return res.status(200).send();
            }

            if (text === '등록 취소') {
                await db.query('UPDATE users SET search_tweet_id=? WHERE user_id=?', [null, senderId]);

                await sendDM(senderId, {
                    text: '등록이 취소되었습니다. 나중에 웹으로도 등록하실 수 있습니다!'
                });

                return res.status(200).send();
            }

            const [user] = await db.query('SELECT search_tweet_id FROM users WHERE user_id=?', [senderId]);
            const tweetId = _.get(user, '[0].search_tweet_id');
            if (tweetId) {
                const {place_name, address_name, road_address_name, phone, x, y} = JSON.parse(quickReply);
                await db.query(`INSERT INTO tweet (tweet_id, name, address, road_address, phone, lat, lng, writer) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                [tweetId, place_name, address_name, road_address_name, phone, x, y, senderId]);

                await sendDM(senderId, {
                    text: `${req.body.users[senderId].name} 님의 지도에 '${place_name}'이(가) 등록되었습니다! 감사합니다.\nhttps://gabolga.gamjaa.com/tweet/${tweetId}`
                });

                return res.status(200).send();
            }
        }

        const url = _.get(req.body, 'direct_message_events[0].message_create.message_data.entities.urls[0].expanded_url');
        if (!url || !statusIdRegex.test(url)) {

            const [user] = await db.query('SELECT search_tweet_id FROM users WHERE user_id=?', [senderId]);

            if (!user.length || !user[0].search_tweet_id) {
                await sendDM(senderId, {
                    text: '궁금한 점이나 건의할 사항이 있으시다면 멘션이나 @_gamjaa으로 DM 보내주세요! 감사합니다.'
                });
    
                return res.status(200).send();
            }

            const {documents} = await localSearch(text);
            const places = documents.map(document => {
                const {place_name, address_name, road_address_name, phone, x, y} = document;
                return {
                    label: place_name,
                    description: `${address_name} / ${phone}`,
                    metadata: JSON.stringify({place_name, address_name, road_address_name, phone, x, y})
                };
            });
            await sendDM(senderId, {
                text: '검색된 장소들입니다. 원하는 장소를 선택해주세요. 다른 키워드로 다시 검색할 수도 있습니다.',
                quick_reply: {
                    type: 'options',
                    options: [
                        ...places,
                        {
                            label: '등록 취소'
                        }
                    ]
                }
            });

            return res.status(200).send();
        }

        const id = statusIdRegex.exec(url)[1];
        const [rows] = await db.query('SELECT name FROM tweet WHERE tweet_id=?', [id]);

        await db.query('INSERT INTO my_map (user_id, tweet_id) VALUES (?, ?)',
            [senderId, id]);
    
        if (rows.length) {
            await sendDM(senderId, {
                text: `${req.body.users[senderId].name} 님의 지도에 '${rows[0].name}'이(가) 등록되었습니다. 확인해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}`
            });
        } else {
            await sendDM(senderId, {
                text: `아직 가볼가에 등록되지 않은 트윗이에요. ${req.body.users[senderId].name} 님께서 직접 등록해보는 건 어떨까요? DM으로 바로 등록할 수도 있습니다.\nhttps://gabolga.gamjaa.com/tweet/${id}?unregistered`,
                quick_reply: {
                    type: 'options',
                    options: [
                        {
                            label: 'DM으로 바로 등록하기',
                            metadata: id
                        }
                    ]
                }
            });
        }


        return res.status(200).send();
    }

    // Follow
    if (req.body.follow_events) {
        await sendDM(req.body.follow_events[0].source.id, {
            text: `반갑습니다, ${req.body.follow_events[0].source.name} 님! 팔로우 해주셔서 감사합니다.\n가볼까 싶은 장소가 적힌 트윗을 DM으로 공유해주세요! ${req.body.follow_events[0].source.name} 님의 지도에 기록해드릴게요.`
        });
        
        return res.status(200).send();
    }

    return res.status(200).send();
}));

module.exports = router;

async function sendDM(target_id, message_data) {
    return T.post('direct_messages/events/new', {
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
