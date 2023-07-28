#!/bin/bash

mkdir -p logs

export NEAR_ENV=mainnet
export NEAR_ACCOUNT_ID=$YOUR_ACCOUNT_ID

cd $(dirname "$0")
DATE=$(date "+%Y_%m_%d")

date | tee -a logs/reg_logs_$DATE.txt
/usr/bin/node ./src/reg_liquidator.js 2>&1 | tee -a logs/reg_logs_$DATE.txt
