const mysql = require('mysql2/promise');
const dbConfig = require('config').get('db');
const connection = mysql.createConnection(dbConfig);

connection.connect();

module.exports = connection;