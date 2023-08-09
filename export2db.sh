#!/bin/bash

mkdir -p logs
export NEAR_ENV=mainnet
export NEAR_ACCOUNT_ID=$YOUR_ACCOUNT_ID
export MIN_DISCOUNT=0.05
cd $(dirname "$0")

DATE=$(date "+%Y_%m_%d")
while :
do
  date | tee -a logs/export2db_$DATE.txt
  /usr/local/bin/node ./src/export2db.js 2>&1 | tee -a logs/export2db_$DATE.txt
  sleep 60
done
