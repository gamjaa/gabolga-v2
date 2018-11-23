const config = require('config');
const postBotConfig = config.get('bot.post');
const twit = require('twit');
const postT = new twit(postBotConfig);
const db = require('./db');
const sendDM = require('./sendDmAsync');

const setMentionPermission = async (userId, isDenied=null, isSendDm=false) => {
    await db.query(`INSERT INTO mention_permission (user_id, is_denied) 
    VALUES (?, ?) 
    ON DUPLICATE KEY UPDATE is_denied=?`, [userId, isDenied, isDenied]);

    if (!isSendDm) {
        return;
    }

    const {data} = await postT.get('users/show', {
        user_id: userId
    });
    const name = data.name;
    const screenName = data.screen_name;

    if (isDenied === null) {
        return await sendDM(userId, {
            text: `안녕하세요, ${name} 님.\n${name} 님께서 올리신 트윗과 관련된 장소를 해당 트윗 답글로 달았습니다. 주소 공유 측면과 함께 홍보성도 띄고 있어서 허락을 구하고자 메시지 드립니다.\n가볼가는 트위터 맛집 등을 편하게 찾아가고자 만든 비영리 사이트입니다. 답글이 달리는 것을 원치 않으시다면 "멘션거부"라고 DM 부탁드립니다.\n좋은 하루 보내시길 바랍니다. 감사합니다.`,
            quick_reply: {
                type: 'options',
                options: [
                    {
                        label: '멘션허락',
                        description: '답글이 달리는 것을 허락합니다',
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
            return Promise.resolve(await postT.post('statuses/update', {
                status: `@${screenName} 안녕하세요. 작성하신 트윗과 관련된 장소를 답글로 달았습니다. 주소 공유 측면과 함께 홍보성도 있어서 허락을 구하고자 연락 드립니다.\n가볼가는 트위터 맛집 등을 편하게 찾아가고자 만든 비영리 사이트입니다. 답글을 원치 않으시면 "멘션거부"라고 DM 부탁드립니다.\n감사합니다`
            }));
        }).catch(async () => Promise.resolve(await setMentionPermission(userId, true)));
    }

    if (isDenied) {
        await sendDM(userId, {
            text: `불편을 드려 죄송합니다. 최근 7일간 ${name} 님 트윗에 달렸던 답글을 삭제하고, 앞으로 답글이 달리지 않도록 처리하겠습니다.\n혹시 생각이 바뀌신다면 언제든지 "멘션허락"이라고 보내주시면 됩니다.\n다시 한 번 죄송하다는 말씀드리며, 좋은 하루 보내시길 바랍니다. 감사합니다.`,
            quick_reply: {
                type: 'options',
                options: [
                    {
                        label: '멘션허락',
                        description: '답글이 달리는 것을 허락합니다',
                        metadata: userId
                    }
                ]
            }
        });

        const {data} = await postT.get('search/tweets', {
            q: `from:gabolga_bot to:${screenName} #가볼가`,
            count: 100
        });
        for (const status of data.statuses) {
            await postT.post('statuses/destroy', {
                id: status.id_str
            });
        }
        return;
    }

    return await sendDM(userId, {
        text: `허락해주셔서 감사합니다, ${name} 님!\n혹시 생각이 바뀌신다면 언제든지 "멘션거부"라고 보내주시면 됩니다. 불편하게 느끼시지 않도록 노력하겠습니다.\n좋은 하루 보내시길 바랍니다.`,
        quick_reply: {
            type: 'options',
            options: [
                {
                    label: '멘션거부',
                    description: '답글이 달리는 것을 거부합니다',
                    metadata: userId
                }
            ]
        }
    });
};

module.exports = setMentionPermission;