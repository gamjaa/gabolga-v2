const naver = require('config').get('naver');
const request = require('request-promise-native');

const bTagRegex = /<\/?b>/g;

module.exports = async (query, startNum) => {
    const {total, start, display, items} = await request.get('https://openapi.naver.com/v1/search/local.json', {
        headers: {
            'X-Naver-Client-Id': naver.id,
            'X-Naver-Client-Secret': naver.secret
        },
        qs: {
            query,
            display: 5,
            start: startNum || 1,
            sort: 'random'
        },
        json: true
    });

    const replacedItems = items.map(item => {
        const name = item.title.replace(bTagRegex, '');
        return {
            name,
            phone: item.telephone,
            address: item.address,
            road_address: item.roadAddress,
            mapx: item.mapx,
            mapy: item.mapy
        };
    });

    return {
        total, start, display, 
        items: replacedItems
    };
};