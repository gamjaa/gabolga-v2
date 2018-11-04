const express = require('express');
const router = express.Router();
const config = require('config');
const naver = config.get('naver');
const request = require('request-promise-native');
const db = require('./common/db');
const wrapAsync = require('./common/wrapAsync');
const localSearch = require('./common/localSearch');

const statusIdRegex = /status\/([0-9]+)/;
const idRegex = /^([0-9]+)$/;

// GET /api/map
router.get('/map', wrapAsync(async (req, res, next) => {
    if (!req.session.isLogin) {
        return res.status(400).send();
    }

    if (!(req.query.minX && req.query.maxX && req.query.minY && req.query.maxY)) {
        return res.status(400).send();
    }

    const [rows] = await db.query(`SELECT tweet.tweet_id, name, mapx, mapy 
        FROM my_map
        JOIN tweet ON my_map.tweet_id=tweet.tweet_id
        WHERE user_id=? AND mapx BETWEEN ? AND ? AND mapy BETWEEN ? AND ?`,
    [req.session.user_id, req.query.minX, req.query.maxX, req.query.minY, req.query.maxY]);
    return res.json(rows);
}));

// GET /api/tweet
router.get('/tweet', function(req, res, next) {
    if (!statusIdRegex.test(req.query.url)) {
        return res.status(400).send();
    }

    if (idRegex.test(req.query.url)) {
        return res.redirect(`/tweet/${req.query.url}`);
    }

    return res.redirect(`/tweet/${statusIdRegex.exec(req.query.url)[1]}`);
});

// GET /api/gabolga/:id
router.get('/gabolga/:id', wrapAsync(async (req, res, next) => {
    if (!req.session.isLogin || !req.params.id) {
        return res.status(400).send();
    }

    if (!idRegex.test(req.params.id)) {
        return res.status(400).send();
    }

    const [rows] = await db.query(`SELECT * FROM my_map WHERE user_id=${req.session.user_id} AND tweet_id=${req.params.id}`);
    if (rows.length) {
        await db.query(`DELETE FROM my_map WHERE user_id=${req.session.user_id} AND tweet_id=${req.params.id}`);
    } else {
        await db.query('INSERT INTO my_map (user_id, tweet_id) VALUES (?, ?)',
            [req.session.user_id, req.params.id]);
    }
    
    return res.json({ isGabolga: !rows.length });
}));

// GET /api/thumb
router.get('/thumb', wrapAsync(async (req, res, next) => {
    return request.get('https://openapi.naver.com/v1/map/staticmap.bin', {
        qs: {
            clientId: naver.id,
            url: 'https://gabolga.gamjaa.com',
            scale: 1,
            crs: 'NHN:128',
            exception: 'json',
            center: `${req.query.mapx},${req.query.mapy}`,
            level: 12,
            w: 505,
            h: 253,
            baselayer: 'default',
            markers: `${req.query.mapx},${req.query.mapy}`
        }
    }).pipe(res);
}));

// GET /api/searchLocal
router.get('/searchLocal', wrapAsync(async (req, res, next) => {
    return res.json(await localSearch(req.query.query, req.query.start));
}));

module.exports = router;
