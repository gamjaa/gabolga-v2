const express = require('express');
const router = express.Router();
const Pageres = require('pageres');
const hostname = require('config').get('domain');
const db = require('./common/db');
const wrapAsync = require('./common/wrapAsync');

const statusIdRegex = /status\/([0-9]+)/;
const idRegex = /^([0-9]+)$/;

// GET /api/map
router.get('/map', wrapAsync(async (req, res, next) => {
    if (!req.session.isLogin) {
        return res.status(400).send();
    }

    if (!(req.query.swLat && req.query.swLng && req.query.neLat && req.query.neLng)) {
        return res.status(400).send();
    }

    const [rows] = await db.query(`SELECT tweet.tweet_id, name, lat, lng 
        FROM my_map
        JOIN tweet ON my_map.tweet_id=tweet.tweet_id
        WHERE user_id=? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
    [req.session.user_id, req.query.swLat, req.query.neLat, req.query.swLng, req.query.neLng]);
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
router.get('/gabolga/:id', function(req, res, next) {
    if (!req.session.isLogin || !req.params.id) {
        return res.status(400).send();
    }

    if (!idRegex.test(req.params.id)) {
        return res.status(400).send();
    }

    db.query(`SELECT * FROM my_map WHERE user_id=${req.session.user_id} AND tweet_id=${req.params.id}`,
        (err, rows) => {
            if (rows.length) {
                return db.query(`DELETE FROM my_map WHERE user_id=${req.session.user_id} AND tweet_id=${req.params.id}`);
            }
            
            return db.query('INSERT INTO my_map (user_id, tweet_id) VALUES (?, ?)',
                [req.session.user_id, req.params.id]);
        });
    
    return res.status(200).send('success');
});

// GET /api/thumb
router.get('/thumb', function(req, res, next) {
    return new Pageres()
        .src(`${hostname}/api/staticMap?lat=${req.query.lat}&lng=${req.query.lng}`, ['600x335', '600x335'])
        .run()
        .then(([stream]) => stream.pipe(res));
});

// GET /api/staticMap
router.get('/staticMap', function(req, res, next) {
    return res.render('thumb', { 
        lat: req.query.lat,
        lng: req.query.lng
    });
});

module.exports = router;
