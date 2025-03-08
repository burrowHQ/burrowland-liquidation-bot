#!/bin/bash

mkdir -p logs

export NEAR_ENV=mainnet

# uncomment this if you want to cover default value
# export NODE_URL=

# uncomment this if you want to cover default value
# export REF_EXCHANGE_CONTRACT_ID=

# uncomment this if you want to cover default value
# export BURROW_CONTRACT_ID=

# The account used for signing.
export NEAR_ACCOUNT_ID=$YOUR_ACCOUNT_ID

# The target account for registration.
export TARGET_NEAR_ACCOUNT_ID=$YOUR_TARGET_ACCOUNT_ID

# default to info
export LOG_LEVEL=debug

cd $(dirname "$0")
DATE=$(date "+%Y_%m_%d")

date | tee -a logs/reg_logs_$DATE.txt
/usr/bin/node ./src/reg_liquidator.js 2>&1 | tee -a logs/reg_logs_$DATE.txt
