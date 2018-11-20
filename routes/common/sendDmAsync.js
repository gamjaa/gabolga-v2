const config = require('config');
const dmBotConfig = config.get('bot.dm');
const twit = require('twit');
const dmT = new twit(dmBotConfig);

module.exports = async (target_id, message_data) => {
    return dmT.post('direct_messages/events/new', {
        event: {
            type: 'message_create',
            message_create: {
                target: {
                    recipient_id: target_id
                },
                message_data
            }
        }
    });
};