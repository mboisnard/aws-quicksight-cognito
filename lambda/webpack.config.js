const path = require('path');

module.exports = {
    entry: './index.js',
    target: 'node',
    mode: 'production',
    optimization:{
        minimize: false
    },
    output: {
        path: path.join(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: "commonjs2"
    }
};
