#!/bin/bash

mkdir -p logs

export NEAR_ENV=mainnet
export NEAR_ACCOUNT_ID=$YOUR_ACCOUNT_ID
export MIN_PROFIT=1
export MIN_DISCOUNT=0.05
export MAX_LIQUIDATION_AMOUNT=20000
export STOP_LIQUIDATION_HEALTH_FACTOR=1000
export LOG_LEVEL='debug'
export LIQUIDATE=true
export FORCE_CLOSE=false
export MARGIN_LIQUIDATE=false
export MARGIN_FORCE_CLOSE=false
export ENCODE_PRIVATE_KEY=$YOUR_ENCODE_PRIVATE_KEY
export LOOP_INTERVAL=10000
export DATA_SERVICE_URL=$YOUR_DATA_SERVICE_URL
export TOPN=20
# export MARGIN_TOPN=20
export REGULAR_PAGED_LIMIT=150
export MARGIN_PAGED_LIMIT=150
export MARGIN_ROUTER_FILE=margin_router.json

cd $(dirname "$0")
DATE=$(date "+%Y_%m_%d")
node ./src/liquidate.js 2>&1 | tee -a logs/logs_$DATE.txt
