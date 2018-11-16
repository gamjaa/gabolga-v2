const ncloud = require('config').get('ncloud');
const request = require('request-promise-native');

const bTagRegex = /<\/?b>/g;

module.exports = async (query) => {
    const {meta, places} = await request.get('https://naveropenapi.apigw.ntruss.com/map-place/v1/search', {
        headers: {
            'X-NCP-APIGW-API-KEY-ID': ncloud.id,
            'X-NCP-APIGW-API-KEY': ncloud.secret
        },
        qs: {
            query,
            coordinate: '127.1054328,37.3595963'
        },
        json: true
    });
    
    const replacedItems = places.map(item => {
        const name = item.name.replace(bTagRegex, '');
        return {
            name,
            phone: item.phone_number,
            address: item.jibun_address,
            road_address: item.road_address,
            lat: item.y,
            lng: item.x,
        };
    });
    
    return {
        total: meta.totalCount,
        items: replacedItems
    };
};