const express = require('express');
const router = express.Router();
const moment = require('moment');
const db = require('./common/db');
const wrapAsync = require('./common/wrapAsync');
const hostname = require('config').get('domain');

// GET /my
router.get('/', function(req, res, next) {
    return res.redirect('/my/map');
});

// GET /my/map
router.get('/map', wrapAsync(async (req, res, next) => {
    if (!req.session.isLogin) {
        return res.redirect(`/login?refer=${req.originalUrl}`);
    }

    const getTweetData = async () => {
        const [tweets] = await db.query(`SELECT tweet.tweet_id, name, address, road_address, phone, lat, lng 
        FROM (SELECT * FROM my_map WHERE user_id=?) AS my_map
        JOIN tweet ON my_map.tweet_id=tweet.tweet_id
        WHERE my_map.tweet_id=?`, [req.session.user_id, req.query.tweet_id]);
        if (!tweets.length) {
            return null;
        }

        return tweets[0];
    };

    const tweet = req.query.tweet_id ? await getTweetData() : {};
    if (!tweet) {
        return res.redirect(`/tweet/${req.query.tweet_id}`);
    }

    return res.render('map', { 
        req,
        title: '내 지도',
        hostname,
        tweet,
    });
}));

// GET /my/list
router.get('/list', wrapAsync(async (req, res, next) => {
    if (!req.session.isLogin) {
        return res.redirect(`/login?refer=${req.originalUrl}`);
    }

    const getOrderBy = () => {
        if (req.query.order_by === 'phone') {
            return 'phone IS NOT NULL, NULLIF(phone, \'\') IS NULL, phone';
        }

        if (['name', 'add_time'].includes(req.query.order_by)) {
            return `${req.query.order_by} IS NOT NULL, ${req.query.order_by}`;
        }

        return 'COALESCE(NULLIF(road_address,\'\'), address) IS NOT NULL, COALESCE(NULLIF(road_address,\'\'), address)';
    };

    const getOrderType = () => {
        return req.query.order_type === 'desc' ? 'DESC' : 'ASC';
    };

    const orderBy = getOrderBy();
    const orderType = getOrderType();
    const [rows] = await db.query(`SELECT my_map.tweet_id, name, road_address, address, phone, add_time 
        FROM my_map 
        LEFT JOIN tweet ON my_map.tweet_id=tweet.tweet_id WHERE user_id=? ORDER BY ${orderBy} ${orderType}`,
    [req.session.user_id]);

    return res.render('list', { 
        req,
        title: '내 지도(목록으로 보기)',

        rows,
        moment,
    });
}));

// GET /my/setting
router.get('/setting', wrapAsync(async (req, res, next) => {
    if (!req.session.isLogin) {
        return res.redirect(`/login?refer=${req.originalUrl}`);
    }

    const [rows] = await db.query('SELECT has_setting, is_auto_tweet, is_anonymous FROM users WHERE user_id=?', [req.session.user_id]);

    return res.render('setting', { 
        req,
        title: '설정',

        name: req.session.screen_name,
        hasRefer: req.query.refer,
        isAutoTweet: !rows[0].has_setting || rows[0].is_auto_tweet,
        isAnonymous: rows[0].has_setting && rows[0].is_anonymous
    });
}));

// POST /my/setting
router.post('/setting', wrapAsync(async (req, res, next) => {
    if (!req.session.isLogin) {
        return res.redirect(`/login?refer=${req.originalUrl}`);
    }

    const isAutoTweet = req.body.is_auto_tweet ? true : false;
    const isAnonymous = req.body.is_anonymous ? true : false;
    await db.query('UPDATE users SET has_setting=?, is_auto_tweet=?, is_anonymous=? WHERE user_id=?', [true, isAutoTweet, isAnonymous, req.session.user_id]);

    if (req.query.refer) {
        return res.redirect(req.query.refer);
    }

    return res.redirect(req.originalUrl);
}));

module.exports = router;
