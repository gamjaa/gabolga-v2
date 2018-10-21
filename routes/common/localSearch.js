const kakaoConfig = require('config').get('kakao');
const request = require('request-promise-native');

module.exports = (query) => request.get('https://dapi.kakao.com/v2/local/search/keyword.json', {
    headers: {
        Authorization: `KakaoAK ${kakaoConfig.rest}`
    },
    qs: {
        query,
        size: 5
    },
    json: true
}).then((err, result, body) => body);