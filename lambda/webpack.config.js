const path = require('path');

module.exports = {
    entry: './index.js',
    target: 'node',
    mode: 'production',
    devtool: 'source-map',
    output: {
        path: path.join(__dirname, 'dist'),
        filename: '[name].js',
        library: {
            type: 'commonjs2'
        },
        libraryTarget: 'commonjs2'
    },
    plugins: []
}
