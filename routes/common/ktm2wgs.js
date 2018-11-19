const kakao = require('config').get('kakao');
const request = require('request-promise-native');

module.exports = async (x, y) => {
    const {documents} = await request.get('https://dapi.kakao.com/v2/local/geo/transcoord.json', {
        headers: {
            Authorization: `KakaoAK ${kakao.app_key}`
        },
        qs: {
            x, y,
            input_coord: 'KTM',
            output_coord: 'WGS84'
        },
        json: true
    });

    return documents[0];
};