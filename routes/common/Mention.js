const _ = require('lodash');
const config = require('config');
const postBotConfig = config.get('bot.post');
const moment = require('moment');
const twit = require('twit');
const postT = new twit(postBotConfig);
const T = require('./twit')();
const db = require('./db');
const sendDM = require('./sendDmAsync');

const getIsDenied = async (userId) => {
    const [mentionPermission] = await db.query('SELECT * FROM mention_permission WHERE user_id=? AND is_denied IS NOT NULL', [userId]);
    const isDenied = _.get(mentionPermission, '[0].is_denied');
    
    return isDenied;
};

const isNeedToSend = async ({retweet_count, favorite_count, created_at}) => {
    const nowDate = moment();
    const tweetDate = moment(created_at, 'ddd MMM DD HH:mm:ss ZZ YYYY');  // Fri Jun 22 04:51:49 +0000 2018
    const durationDays = moment.duration(nowDate.diff(tweetDate)).asDays();
    
    const isSendMention = retweet_count + favorite_count >= 2000 
        || (durationDays <= 2 && retweet_count + favorite_count >= 40) || (durationDays <= 7 && retweet_count + favorite_count >= 200);

    if (!isSendMention) {
        return false;
    }

    return true;
};

const appendToQue = async (userId, tweetId) => {
    return await db.query('INSERT INTO mention_queue (user_id, tweet_id) VALUES (?, ?)',
        [userId, tweetId]);
};

const sendMentionInQue = async (userId) => {
    const [que] = await db.query('SELECT tweet_id, name, address, road_address FROM tweet WHERE tweet_id IN (SELECT tweet_id FROM mention_queue WHERE user_id=?)', [userId]);
    const user = (await T.get('users/show', { user_id: userId })).data;

    que.forEach(async ({tweetId, name, road_address, address}) => {
        await db.query('DELETE FROM mention_queue WHERE tweet_id=?', [tweetId]);
        await postT.post('statuses/update', {
            status: `@${user.screen_name} ${name}\n${road_address || address}\n#가볼가 에서 나만의 지도에 '${name}'을(를) 기록해보세요!\nhttps://gabolga.gamjaa.com/tweet/${tweetId}`,
            in_reply_to_status_id: tweetId
        });
    });
};

const setPermission = async (userId, isDenied) => {
    return await db.query(`INSERT INTO mention_permission (user_id, is_denied) 
    VALUES (?, ?) 
    ON DUPLICATE KEY UPDATE is_denied=?`, [userId, isDenied, isDenied]);
};

const executeSendProcess = async (tweetId, senderId, placeData, timestamp) => {
    const {data} = await T.get('statuses/show', {
        id: tweetId
    });

    const isDenied = getIsDenied(data.user.id_str);
    if (isDenied) {
        // 멘션 거부
        return;
    }

    if (data.user.id_str !== senderId && !isNeedToSend(data)) {
        // 멘션 기준 미달
        return;
    }

    if (isDenied == undefined) {
        // 멘션 허용 정보 없음
        // DM 전송
        await sendDM(data.user.id_str, {
            text: `안녕하세요, ${data.user.name} 님. 인용한 트윗에 관련된 장소를 답글로 달아도 되는지 허락을 구하고자 연락드립니다.\n가볼가는 트위터 맛집 등을 편하게 기록할 수 있도록 만든 비영리 사이트입니다.\n멘션허용, 또는 멘션거부라고 응답해주시면 자동 처리됩니다. 감사합니다.\nhttps://twitter.com/i/status/${tweetId}`,
            quick_reply: {
                type: 'options',
                options: [
                    {
                        label: '멘션허용',
                        description: '답글이 달리는 것을 허용합니다',
                        metadata: 1
                    },
                    {
                        label: '멘션거부',
                        description: '답글이 달리는 것을 거부합니다',
                        metadata: 0
                    }
                ]
            }
        }).catch(async () => {
            // DM 불가 시 멘션 전송
            return Promise.resolve(await postT.post('statuses/update', {
                status: `@${data.user.screen_name} 안녕하세요. 인용한 트윗에 관련된 장소를 답글로 달아도 되는지 허락을 구하고자 연락드립니다.\n가볼가는 트위터 맛집 등을 편하게 기록할 수 있도록 만든 비영리 사이트입니다.\n멘션허용, 또는 멘션거부라고 응답해주시면 자동 처리됩니다. 감사합니다.\nhttps://twitter.com/i/status/${tweetId}`
            }));
        }).catch(async () => {
            // 멘션 불가 시 거부한 것으로 처리
            return Promise.resolve(await setPermission(data.user.id_str, true));
        });
        
        // 큐에 등록
        return await appendToQue(data.user.id_str, data.id_str);
    }

    return await postT.post('statuses/update', {
        status: `@${data.user.screen_name} ${placeData.name}\n${placeData.road_address || placeData.address}\n#가볼가 에서 나만의 지도에 '${placeData.name}'을(를) 기록해보세요!\nhttps://gabolga.gamjaa.com/tweet/${tweetId}` + (timestamp ? `?edited_at=${timestamp}` : ''),
        in_reply_to_status_id: tweetId
    }).catch(async () => Promise.resolve(await setPermission(data.user.id_str, true)));
};

module.exports = { setPermission, executeSendProcess, sendMentionInQue };