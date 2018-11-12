const express = require('express');
const router = express.Router();
const _ = require('lodash');
const oauth = require('oauth');
const config = require('config');
const hostname = config.get('domain');
const twitConfig = config.get('twitter');
const dmBotConfig = config.get('bot.dm');
const dmT = new require('twit')(dmBotConfig);
const db = require('./common/db');
const wrapAsync = require('./common/wrapAsync');

// GET /
router.get('/', function(req, res, next) {
    return res.render('index', { 
        req,
        title: '트위터 맛집, 지도로 정리해드립니다!'
    });
});

// GET /guide
router.get('/guide', function(req, res, next) {
    return res.render('guide', { 
        req,
        title: '사용법'
    });
});

// GET /random
router.get('/random', wrapAsync(async (req, res, next) => {
    const [rows] = await db.query('SELECT tweet_id FROM tweet WHERE name IS NOT NULL');

    return res.redirect(`/tweet/${rows[_.random(rows.length - 1, false)].tweet_id}`);
}));

// GET /search
router.get('/search', wrapAsync(async (req, res, next) => {
    if (!req.query.q || req.query.q.length < 2 || /^\s*$/.test(req.query.q)) {
        return res.status(400).send('2글자 이상으로 검색해주세요');
    }
    
    const q = `(*${req.query.q.replace(/\s/g, '* *')}*) ("${req.query.q}")`;
    const query = req.session.isLogin 
        ? `SELECT tweet.tweet_id, name, address, road_address, phone, user_id, MATCH(name, address, road_address) AGAINST(? IN BOOLEAN MODE) as score
        FROM tweet
        LEFT JOIN (SELECT * FROM my_map WHERE user_id='${req.session.user_id}') my_map ON tweet.tweet_id=my_map.tweet_id
        WHERE MATCH(name, address, road_address) AGAINST(? IN BOOLEAN MODE)
        ORDER BY score DESC`
        : `SELECT tweet_id, name, road_address, address, phone, MATCH(name, address, road_address) AGAINST(? IN BOOLEAN MODE) as score
        FROM tweet
        WHERE MATCH(name, address, road_address) AGAINST(? IN BOOLEAN MODE)
        ORDER BY score DESC`
    const [rows] = await db.query(query, [q, q]);

    return res.render('search', { 
        req,
        title: `검색 결과(${req.query.q})`,

        rows,
    });
}));

// GET /login
router.get('/login', function(req, res, next) {
    if (req.session.isLogin) {
        return res.redirect(req.query.refer || '/');
    }

    const consumer = new oauth.OAuth(
        'https://api.twitter.com/oauth/request_token', 
        'https://api.twitter.com/oauth/access_token',
        twitConfig.consumer_key, twitConfig.consumer_secret,
        '1.0A', `${hostname}/callback?refer=${req.query.refer}`, 'HMAC-SHA1'
    );
    return consumer.getOAuthRequestToken((error, oauth_token, oauth_token_secret, results) => {
        if (error) {
            return res.status(400).send(error);
        }
        req.session.oauth_token = oauth_token;
        req.session.oauth_token_secret = oauth_token_secret;
        return res.redirect(`https://api.twitter.com/oauth/authorize?oauth_token=${oauth_token}`);
    });
});

// GET /callback
router.get('/callback', function(req, res, next) {
    const refer = req.query.refer || '/';

    if (req.session.isLogin) {
        return res.redirect(refer);
    }

    if (req.query.denied) {
        return res.redirect(`/login?refer=${refer}`);
    }

    const consumer = new oauth.OAuth(
        'https://api.twitter.com/oauth/request_token', 
        'https://api.twitter.com/oauth/access_token',
        twitConfig.consumer_key, twitConfig.consumer_secret,
        '1.0A', `${hostname}/callback?refer=${req.query.refer}`, 'HMAC-SHA1'
    );
    return consumer.getOAuthAccessToken(
        req.session.oauth_token, 
        req.session.oauth_token_secret, 
        req.query.oauth_verifier, 
        (err, oauth_token, oauth_token_secret, results) => {
            if (err) {
                return res.status(400).send(err);
            }
            return db.query('SELECT oauth_token FROM users WHERE user_id=?', [results.user_id]
            ).then(([rows]) => {
                if (!_.get(rows, '[0].oauth_token')) {
                    dmT.post('direct_messages/events/new', {
                        event: {
                            type: 'message_create',
                            message_create: {
                                target: {
                                    recipient_id: results.user_id
                                },
                                message_data: {
                                    text: '가볼가에 가입해주셔서 감사합니다!\n가볼가 웹사이트에서 \'가볼가\'한 장소가 정리된 지도를 보실 수 있습니다.\n혹시 가볼가 계정 팔로우 하셨나요? 팔로우 하시면 더 편리하게 이용하실 수 있습니다.',
                                    ctas: [
                                        {
                                            type: 'web_url',
                                            label: `${results.screen_name} 님의 지도`,
                                            url: 'https://gabolga.gamjaa.com/my/map'
                                        },
                                        {
                                            type: 'web_url',
                                            label: '팔로우 하기',
                                            url: 'https://twitter.com/intent/follow?user_id=903176813517479936'
                                        },
                                    ],
                                }
                            }
                        }
                    });
                }

                return db.query(`INSERT INTO users (user_id, screen_name, oauth_token, oauth_token_secret) 
                    VALUES (?, ?, ?, ?) 
                    ON DUPLICATE KEY UPDATE screen_name=?, oauth_token=?, oauth_token_secret=?`, 
                [results.user_id, results.screen_name, oauth_token, oauth_token_secret, 
                    results.screen_name, oauth_token, oauth_token_secret]);
            }).then(() => {
                req.session.isLogin = true;
                req.session.user_id = results.user_id;
                req.session.screen_name = results.screen_name;

                return db.query('SELECT has_setting FROM users WHERE user_id=?', [results.user_id]);
            }).then(([rows]) => {
                if (!rows[0].has_setting) {
                    return res.redirect(`/my/setting?refer=${refer}`);
                }

                return res.redirect(refer);
            });
        });
});

router.get('/logout', function(req, res, next) {
    req.session.destroy();
    return res.redirect(req.query.refer || '/');
});

router.get('*.php', function(req, res, next) {
    return res.redirect('/');
});

module.exports = router;
