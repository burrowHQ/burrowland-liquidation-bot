#!/bin/bash

mkdir -p logs


######## COMMON CONFIG SECTION ########
export NEAR_ENV=mainnet
export DOCKER_ENV=true
# uncomment this if you want to cover default value
# export NODE_URL=

# uncomment this if you want to cover default value
# export REF_EXCHANGE_CONTRACT_ID=

# uncomment this if you want to cover default value
export PRICE_ORACLE_CONTRACT_ID=meme-priceoracle.ref-labs.near

# uncomment this if you want to cover default value
export BURROW_CONTRACT_ID=meme-burrow.ref-labs.near

# must provide the liqudiator account ID
# export NEAR_ACCOUNT_ID=

# default to info
export LOG_LEVEL=info

# default to 5000 (5 seconds)
export LOOP_INTERVAL=60000

# uncomment this if using an AES ciphered private key, otherwise, use key file.
# export ENCODE_PRIVATE_KEY=


######## LIQUIDATION RELATED SECTION ########
# default to 1.0, filter out debts or margin positions that bring profit less than it.
export MIN_PROFIT=1


######## MARGIN POSITIONS SECTION ########
# default to false, switch of liquidation for margin positions
export MARGIN_LIQUIDATE=true
# default to false, switch for enabling/disabling liquidation mode
# export MARGIN_LIQUIDATE_DIRECT_MODE = true
# default to false, switch of forcing close for margin positions
# export MARGIN_FORCE_CLOSE=true

# uncomment this if using a service to provide margin positions
# export MARGIN_DATA_SERVICE_URL=
#   default to 50, a pre-sorting on debts fetched from MARGIN_DATA_SERVICE,
#   it is sorted by profit and then select the top MARGIN_TOPN positions.
# export MARGIN_TOPN=50

# default to 150, page size when fetch margin positions on-chain
export MARGIN_PAGED_LIMIT=150

node ./src/combine.js
