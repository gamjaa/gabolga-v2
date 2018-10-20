const twitConfig = require('config').get('twitter');
const twit = require('twit');

module.exports = (access_token, access_token_secret) => {
    if (!access_token)
        return new twit(Object.assign({ app_only_auth: true }, twitConfig));

    return new twit(Object.assign({ access_token, access_token_secret }, twitConfig));
};