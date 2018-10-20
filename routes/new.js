const express = require('express');
const router = express.Router();

// GET /new
router.get('/', function(req, res, next) {
    return res.redirect('/');
});

// POST /new
router.get('/', function(req, res, next) {
    return res.redirect('/');
});

module.exports = router;
