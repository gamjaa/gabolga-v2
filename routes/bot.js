const express = require('express');
const router = express.Router();
const _ = require('lodash');
const cryptojs = require('crypto-js');
const twit = require('twit');
const botConfig = require('config').get('bot');
const T = new twit(botConfig);
const db = require('./common/db');

const statusIdRegex = /status\/([0-9]+)/;

// GET /webhook
router.get('/', function(req, res, next) {
    if (req.query.crc_token) {
        return res.json({
            response_token: `sha256=${cryptojs.enc.Base64.stringify(cryptojs.HmacSHA256(req.query.crc_token, botConfig.consumer_secret))}`
        });
    }

    return res.status(200).send();
});

// POST /webhook
router.post('/', function(req, res, next) {
    const header = req.headers['x-twitter-webhooks-signature'];
    if (!header) {
        return res.status(400).send();
    }

    const headerCheck = `sha256=${cryptojs.enc.Base64.stringify(cryptojs.HmacSHA256(req.rawBody, botConfig.consumer_secret))}`;
    if (header !== headerCheck) {
        return res.status(400).send();
    }
    
    // DM
    if (req.body.direct_message_events && 
        req.body.direct_message_events[0].message_create.sender_id !== '903176813517479936') {
        const sendDM = (text) => T.post('direct_messages/events/new', {
            event: {
                type: 'message_create',
                message_create: {
                    target: {
                        recipient_id: req.body.direct_message_events[0].message_create.sender_id
                    },
                    message_data: {
                        text
                    }
                }
            }
        }, (err) => {
            if (err) {
                console.error('DM Error:', err);
                return res.status(500).send();
            }
            
            return res.status(200).send();
        });
        
        const url = _.get(req.body, 'direct_message_events[0].message_create.message_data.entities.urls[0].expanded_url');
        if (!url || !statusIdRegex.test(url)) {
            db.query('INSERT INTO dm (dm_id, user_id, is_tweet) VALUES (?, ?, ?)', 
                [req.body.direct_message_events[0].id, req.body.direct_message_events[0].message_create.sender_id, false], (err) => {
                    if (err) {
                        console.error('DB Error:', err);
                    }
                });
            return sendDM('궁금한 점이나 건의할 사항이 있으시다면 멘션이나 @_gamjaa으로 DM 보내주세요! 감사합니다.');
        }

        const id = statusIdRegex.exec(url)[1];
        return db.query('SELECT name FROM tweet WHERE tweet_id=?', [id], 
            (err, rows) => {
                if (err) {
                    console.error('DB Error:', err);
                    return res.status(500).send();
                }

                db.query('INSERT INTO my_map (user_id, tweet_id) VALUES (?, ?)',
                    [req.body.direct_message_events[0].message_create.sender_id, id], (err) => {
                        if (err) {
                            console.error('DB Error:', err);
                        }
                    });

                db.query('INSERT INTO dm (dm_id, user_id, is_tweet) VALUES (?, ?, ?)', 
                    [req.body.direct_message_events[0].id, req.body.direct_message_events[0].message_create.sender_id, true], (err) => {
                        if (err) {
                            console.error('DB Error:', err);
                        }
                    });
    
                const text = !rows.length 
                    ? `아직 가볼가에 등록되지 않은 트윗이에요. 직접 등록해주시면 ${req.body.users[req.body.direct_message_events[0].message_create.sender_id].name} 님의 지도에 장소가 기록된답니다!\nhttps://gabolga.gamjaa.com/tweet/${id}?unregistered`
                    : `${req.body.users[req.body.direct_message_events[0].message_create.sender_id].name} 님의 지도에 '${rows[0].name}'이(가) 등록되었습니다. 확인해보세요!\nhttps://gabolga.gamjaa.com/tweet/${id}`;
                return sendDM(text);
            });
    }

    // Follow
    if (req.body.follow_events) {
        return T.post('direct_messages/events/new', {
            event: {
                type: 'message_create',
                message_create: {
                    target: {
                        recipient_id: req.body.follow_events[0].source.id
                    },
                    message_data: {
                        text: `반갑습니다, ${req.body.follow_events[0].source.name} 님! 팔로우 해주셔서 감사합니다.\n가볼까 싶은 장소가 적힌 트윗을 DM으로 공유해주세요! ${req.body.follow_events[0].source.name} 님의 지도에 기록해드릴게요.`
                    }
                }
            }
        }, (err) => {
            if (err) {
                console.error('DM Error:', err);
                return res.status(500).send();
            }

            return res.status(200).send();
        });
    }

    return res.status(200).send();
});

module.exports = router;
