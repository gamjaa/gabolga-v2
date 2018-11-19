const express = require('express');
const router = express.Router();
const config = require('config');
const ncloud = config.get('ncloud');
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

    if (!(req.query.minLat && req.query.maxLat && req.query.minLng && req.query.maxLng)) {
        return res.status(400).send();
    }

    const [rows] = await db.query(`SELECT tweet.tweet_id, name, address, road_address, phone, lat, lng 
        FROM (SELECT * FROM my_map WHERE user_id=?) AS my_map
        JOIN tweet ON my_map.tweet_id=tweet.tweet_id
        WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    [req.session.user_id, req.query.minLat, req.query.maxLat, req.query.minLng, req.query.maxLng]);
    return res.json(rows);
}));

// GET /api/tweet
router.get('/tweet', function(req, res, next) {
    if (idRegex.test(req.query.url)) {
        return res.redirect(`/tweet/${req.query.url}`);
    }
    
    if (!statusIdRegex.test(req.query.url)) {
        return res.redirect(`/search?q=${req.query.url}`);
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
    return request.get('https://naveropenapi.apigw.ntruss.com/map-static/v2/raster', {
        headers: {
            'X-NCP-APIGW-API-KEY-ID': ncloud.id,
            'X-NCP-APIGW-API-KEY': ncloud.secret
        },
        qs: {
            center: `${req.query.lng},${req.query.lat}`,
            level: 12,
            w: 505,
            h: 253,
            scale: 1,
            markers: `pos:${req.query.lng} ${req.query.lat}`,
            ClientID: ncloud.id
        }
    }).pipe(res);
}));

// GET /api/searchLocal
router.get('/searchLocal', wrapAsync(async (req, res, next) => {
    await db.query('INSERT INTO search_log(tweet_id, keyword) VALUES (?, ?)', [req.query.tweet_id, req.query.query]);

    return res.json(await localSearch(req.query.query));
}));

module.exports = router;
