const _ = require('lodash');
const moment = require('moment');
const db = require('./db');
const setMentionPermission = require('./setMentionPermissionAsync');

module.exports = async ({user, retweet_count, created_at}, userId) => {
    if (user.id_str === userId) {
        return true;
    }

    const [mentionPermission] = await db.query('SELECT * FROM mention_permission WHERE user_id=?', [user.id_str]);
    const isDenied = _.get(mentionPermission, '[0].is_denied');
    
    if (isDenied) {
        return false;
    }
    
    const nowDate = moment();
    const tweetDate = moment(created_at, 'ddd MMM DD HH:mm:ss ZZ YYYY');  // Fri Jun 22 04:51:49 +0000 2018
    const durationDays = moment.duration(nowDate.diff(tweetDate)).asDays();
    
    const isSendMention = retweet_count >= 1000 
        || (durationDays <= 2 && retweet_count >= 20) || (durationDays <= 7 && retweet_count >= 100);

    if (!isSendMention) {
        return false;
    }
    
    if (!mentionPermission.length) {
        await setMentionPermission(user.id_str, null, true);
    }

    return true;
};