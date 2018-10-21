const mysql = require('mysql2');
const dbConfig = require('config').get('db');
const pool = mysql.createPool(dbConfig);
module.exports = pool.promise();