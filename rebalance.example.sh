#!/bin/bash

mkdir -p logs


######## COMMON CONFIG SECTION ########
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


######## REBALANCE SECTION ########
# default to 1, means:
# - withdraw a token from burrow if market value greater than $1,
# - sell to wnear if a wallet token's market value is greater than $1,
# - buy and repay a token's debt if the debt's market value is greater than $1.
export MIN_SWAP_AMOUNT=1

# default to 0.5, define the minimum repay value for any single debt token.
export MIN_REPAY_AMOUNT=0.5

# default to 0.5, means a slippage of 0.5%
export MAX_SLIPPAGE=0.5

# default to 5, exit after failure of 5 times
export SWAP_FAILED_LIMIT=5


cd $(dirname "$0")
node ./src/rebalance.js 2>&1 
