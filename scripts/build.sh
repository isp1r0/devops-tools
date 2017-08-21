#!/usr/bin/env bash

rm -rf dist
node_modules/.bin/tsc -p ./ || exit 1
cp -r server/front dist/server || exit 1
