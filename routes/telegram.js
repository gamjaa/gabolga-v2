const TelegramBot = require('node-telegram-bot-api');
const telegramConfig = require('config').get('telegram');
const bot = new TelegramBot(telegramConfig.token);

module.exports = (...message) => {
    let text = '';
    message.forEach(msg => {
        text += (typeof msg === 'string') ? msg : JSON.stringify(msg, null, 4);
        text += '\n';
    });
    return bot.sendMessage(telegramConfig.chat_id, text);
};