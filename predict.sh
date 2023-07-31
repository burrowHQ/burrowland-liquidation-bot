#!/bin/bash

export NEAR_ENV=mainnet
export NEAR_ACCOUNT_ID=
export MIN_PROFIT=1
export MIN_DISCOUNT=0.05
export MAX_LIQUIDATION_AMOUNT=20000
# default MAX_WITHDRAW_COUNT 5. Set to 0 if you want to disable withdraw
export MAX_WITHDRAW_COUNT=

export LIQUIDATION_ACCOUNT_ID=khasinmark.near
# export TAKE_COLLATERAL_PRIORITY=linear-protocol.near
# export REPAY_BORROW_PRIORITY=wrap.near,dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near

/usr/local/bin/node ./src/predict.js 