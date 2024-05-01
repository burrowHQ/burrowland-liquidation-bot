#!/bin/bash

export NEAR_ENV=mainnet

cd $(dirname "$0")
node ./src/daily_check.js
