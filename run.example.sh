#!/bin/bash

mkdir -p logs

export NEAR_ENV=testnet

# uncomment this if you want to cover default value
# export NODE_URL=

# uncomment this if you want to cover default value
# export REF_EXCHANGE_CONTRACT_ID=

# uncomment this if you want to cover default value
# export PRICE_ORACLE_CONTRACT_ID=

# uncomment this if you want to cover default value
# export BURROW_CONTRACT_ID=

# must provide the liqudiator account ID
export NEAR_ACCOUNT_ID=your_liquidator_id.testnet


# default to info
export LOG_LEVEL=debug

# default to 5000 (5 seconds)
export LOOP_INTERVAL=60000

# uncomment this if using an AES ciphered private key, otherwise, use key file.
# export ENCODE_PRIVATE_KEY=


# default to 1.0, filter out debts or margin positions that bring profit less than it.
export MIN_PROFIT=1.0


# default to false, switch of forcing close for regular debts 
export FORCE_CLOSE=true
# default to false, switch of liquidation for regular debts
export LIQUIDATE=true

# default to 0, filter out all debt that less than $5 adjusted_gap,
# Note: must set to 0 if switch on FORCE_CLOSE
export MIN_ADJUSTGAP=5

# default to 0.025, filter out those HF greater than (1-0.025*2)
export MIN_DISCOUNT=0.025

# default to $20000, maximum repay value
export MAX_LIQUIDATION_AMOUNT=20000

# default to 10, minimum HF of liquidator, 10 * 100%
export STOP_LIQUIDATION_HEALTH_FACTOR=10

# default to 5, 
export MAX_WITHDRAW_COUNT=5

# uncomment this if using a service to provide debts
# export DATA_SERVICE_URL=

# default to 150, page size when fetch debts on-chain
export REGULAR_PAGED_LIMIT=150

# default to 50
export TOPN=50


# default to false, switch of liquidation for margin positions
export MARGIN_LIQUIDATE=false
# default to false, switch of forcing close for margin positions
export MARGIN_FORCE_CLOSE=false

# uncomment this if using a service to provide margin positions
# export MARGIN_DATA_SERVICE_URL=

# default to 150, page size when fetch margin positions on-chain
export MARGIN_PAGED_LIMIT=150

# default to 50
export MARGIN_TOPN=50

# default to null
export MARGIN_ROUTER_FILE=margin_router.json

cd $(dirname "$0")
node ./src/liquidate.js 2>&1 
