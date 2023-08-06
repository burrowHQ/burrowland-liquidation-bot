#!/bin/bash

export NEAR_ENV=mainnet
export NEAR_ACCOUNT_ID=
export MIN_PROFIT=1
export MIN_DISCOUNT=0.05
export MAX_LIQUIDATION_AMOUNT=20000
# default MAX_WITHDRAW_COUNT 5. Set to 0 if you want to disable withdraw
export MAX_WITHDRAW_COUNT=

# export LIQUIDATION_ACCOUNT_ID=a2254578818ad84ccabf9e85cb661833db3f08c980509e7fd0e3ba408f97252c
export LIQUIDATION_ACCOUNT_ID=f91c70b9de67737c5b9f00772d20c8f55084d2210603574e4ecbb7d39a130203
export TAKE_COLLATERAL_PRIORITY=linear-protocol.near
# export REPAY_BORROW_PRIORITY=wrap.near,dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near

node ./src/predict.js 
