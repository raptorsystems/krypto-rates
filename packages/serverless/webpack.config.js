/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-call */
const path = require('path')
const slsw = require('serverless-webpack')
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer')
const nodeExternals = require('webpack-node-externals')

const isLocal = slsw.lib.webpack.isLocal

const plugins = []

if (slsw.lib.options.analyze) plugins.push(new BundleAnalyzerPlugin())

module.exports = {
  mode: isLocal ? 'development' : 'production',
  entry: slsw.lib.entries,
  target: 'node',
  devtool: isLocal ? 'cheap-module-source-map' : false,
  plugins,
  externals: isLocal
    ? [
        nodeExternals({
          modulesDir: path.resolve(__dirname, '../../node_modules'),
          allowlist: [/^@raptorsystems/],
        }),
      ]
    : {
        'aws-sdk': 'aws-sdk',
        // https://github.com/graphql-nexus/schema/issues/283
        prettier: 'prettier',
      },
  module: {
    rules: [
      // https://webpack.js.org/configuration/module/#resolvefullyspecified
      {
        test: /\.m?js/,
        resolve: {
          fullySpecified: false,
        },
      },
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        loader: 'ts-loader',
        options: {
          // Pevents https://github.com/graphql-nexus/schema/issues/342
          transpileOnly: true,
        },
      },
    ],
  },
  resolve: {
    extensions: [
      '.mjs', // https://github.com/graphql/graphql-js/issues/1272#issuecomment-454292053
      '.js',
      '.ts',
    ],
  },
  output: {
    libraryTarget: 'commonjs2',
    path: path.join(__dirname, '.webpack'),
  },
}
