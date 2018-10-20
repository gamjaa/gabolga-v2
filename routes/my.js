const express = require('express');
const router = express.Router();
const db = require('./common/db');
const moment = require('moment');

// GET /my
router.get('/', function(req, res, next) {
    return res.redirect('/my/map');
});

// GET /my/map
router.get('/map', function(req, res, next) {
    if (!req.session.isLogin) {
        return res.redirect('/login?refer=/my/map');
    }

    return res.render('map', { 
        req,
        title: '내 지도',
    });
});

// GET /my/list
router.get('/list', function(req, res, next) {
    if (!req.session.isLogin) {
        return res.redirect('/login?refer=/my/list');
    }

    return db.query(`SELECT my_map.tweet_id, name, road_address, address, phone, add_time 
        FROM my_map 
        LEFT JOIN tweet ON my_map.tweet_id=tweet.tweet_id WHERE user_id=? ORDER BY tweet.road_address DESC`,
    [req.session.user_id],
    (err, rows) => {
        if (err) {
            return res.status(500).send(err);
        }

        return res.render('list', { 
            req,
            title: '내 지도(목록으로 보기)',

            rows,
            moment,
        });
    });
});

module.exports = router;
