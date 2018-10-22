const createError = require('http-errors');
const express = require('express');
const path = require('path');
const session = require('express-session');
const mysqlStore = require('express-mysql-session')(session);
const logger = require('morgan');
const config = require('config');

const indexRouter = require('./routes/index');
const tweetRouter = require('./routes/tweet');
const myRouter = require('./routes/my');
const apiRouter = require('./routes/api');
const newRouter = require('./routes/new');
const webhookRouter = require('./routes/bot');

const app = express();

const rawBodySaver = function (req, res, buf, encoding) {
    if (buf && buf.length) {
        req.rawBody = buf.toString(encoding || 'utf8');
    }
};

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));

app.use(express.json({ verify: rawBodySaver }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionStore = new mysqlStore(config.get('db'));
app.use(session(Object.assign({ store: sessionStore }, config.get('session'))));

app.use('/', indexRouter);
app.use('/tweet', tweetRouter);
app.use('/my', myRouter);
app.use('/api', apiRouter);
app.use('/new', newRouter);
app.use('/webhook', webhookRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    console.error(err);

    // render the error page
    res.status(err.status || 500);
    res.render('error');
});

module.exports = app;
