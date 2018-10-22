const express = require('express');
const router = express.Router();
const _ = require('lodash');
const oauth = require('oauth');
const config = require('config');
const hostname = config.get('domain');
const twitConfig = config.get('twitter');
const db = require('./common/db');
const wrapAsync = require('./common/wrapAsync');

// GET /
router.get('/', function(req, res, next) {
    return res.render('index', { 
        req,
        title: '트위터 맛집, 대신 정리해드립니다!'
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
            return db.query(`INSERT INTO users (user_id, screen_name, oauth_token, oauth_token_secret) 
                VALUES (?, ?, ?, ?) 
                ON DUPLICATE KEY UPDATE screen_name=?, oauth_token=?, oauth_token_secret=?`, 
            [results.user_id, results.screen_name, oauth_token, oauth_token_secret, 
                results.screen_name, oauth_token, oauth_token_secret]
            ).then(() => {
                req.session.isLogin = true;
                req.session.user_id = results.user_id;
                req.session.screen_name = results.screen_name;
                req.session.oauth_token = oauth_token;
                req.session.oauth_token_secret = oauth_token_secret;

                return db.query('SELECT has_setting FROM users WHERE user_id=?', [results.user_id]);
            }).then(rows => {
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
