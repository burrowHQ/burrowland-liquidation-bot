#!/bin/bash

mkdir -p logs

export NEAR_ENV=mainnet
export NEAR_ACCOUNT_ID=$YOUR_ACCOUNT_ID
export MIN_PROFIT=1
export MIN_DISCOUNT=0.05
export MAX_LIQUIDATION_AMOUNT=20000
export ENCODE_PRIVATE_KEY=$YOUR_ENCODE_PRIVATE_KEY

export DB_HOST=127.0.0.1
export DB_NAME=refdb
export DB_USER=postgres
export DB_PASSWORD=yourpassword

cd $(dirname "$0")
DATE=$(date "+%Y_%m_%d")
node ./src/liquidate.js 2>&1 | tee -a logs/logs_$DATE.txt
