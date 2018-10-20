const express = require('express');
const router = express.Router();
const _ = require('lodash');
const db = require('./common/db');

const statusIdRegex = /status\/([0-9]+)/;
const idRegex = /^([0-9]+)$/;

// GET /tweet/:id
router.get('/:id', function(req, res, next) {
    if (statusIdRegex.test(req.params.id)) {
        return res.redirect(301, `/tweet/${statusIdRegex.exec(req.params.id)[1]}`);
    }

    if (!idRegex.test(req.params.id)) {
        return res.status(400).send();
    }
    
    const id = idRegex.exec(req.params.id)[1];
    const query = !req.session.isLogin 
        ? `SELECT name, address, road_address, phone, lat, lng, image_url 
        FROM tweet WHERE tweet.tweet_id=?`
        : `SELECT name, address, road_address, phone, lat, lng, image_url, user_id 
        FROM tweet 
        LEFT JOIN my_map ON (tweet.tweet_id=my_map.tweet_id AND my_map.user_id='${req.session.user_id}')
        WHERE tweet.tweet_id=?`;
    return db.query(query, [id], (error, rows) => {
        const twit = require('./common/twit')();
        return twit.get('statuses/oembed', {
            id, 
            hide_media: true, 
            hide_thread: true, 
            lang: 'ko'
        }).catch((err) => Promise.resolve({ data: { html: '<div id="data" style="line-height: 100px; text-align: center;">삭제되거나 비공개된 트윗입니다</div>' } })
        ).then(result => {
            return res.render('tweet', { 
                req,
                title: _.get(rows, '[0].name'),
                isRegistered: rows.length,
                
                tweetHtml: result.data.html,
                id, 
                name: _.get(rows, '[0].name'),
                address: _.get(rows, '[0].address'),
                roadAddress: _.get(rows, '[0].road_address'),
                phone: _.get(rows, '[0].phone'),
                lat: _.get(rows, '[0].lat'),
                lng: _.get(rows, '[0].lng'),
                imageUrl: _.get(rows, '[0].image_url'),

                isGabolga: _.get(rows, '[0].user_id'),
            });
        });
    });
});

// PUT /tweet/:id
// 등록 및 수정 요청
router.put('/:id', function(req, res, next) {
    if (!req.session.isLogin) {
        return res.status(400).send();
    }

    if (!(req.body.name && (req.body.address || req.body.road_address) && req.body.lat && req.body.lng)) {
        return res.status(400).send();
    }

    if (statusIdRegex.test(req.params.id)) {
        return res.redirect(301, `/tweet/${statusIdRegex.exec(req.params.id)[1]}`);
    }

    if (!idRegex.test(req.params.id)) {
        return res.status(400).send();
    }

    const id = idRegex.exec(req.params.id)[1];
    return db.query(`SELECT name FROM tweet WHERE tweet_id=${id}`, (error, rows) => {
        if (rows.length) {
            return res.status(400).send();
        }

        return db.query(`INSERT INTO tweet (tweet_id, name, address, road_address, phone, lat, lng, writer) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
        [id, req.body.name, req.body.address, req.body.road_address, req.body.phone, req.body.lat, req.body.lng, req.session.user_id],
        (error) => {
            if (error) {
                return res.status(500).send(error);
            }
            
            return res.status(200).send('success');
        });
    });

});

module.exports = router;
