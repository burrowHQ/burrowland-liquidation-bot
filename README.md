# burrowland-liquidation-bot
An example bot to use with borrowland contract for account liquidations

Before run this bot, need to change the setting in run.sh

export NEAR_ENV=mainnet

export NEAR_ACCOUNT_ID=$YOUR_ACCOUNT_ID

export MIN_PROFIT=1

export MIN_DISCOUNT=0.05

export MAX_LIQUIDATION_AMOUNT=20000

# config the postgres database
export DB_HOST=127.0.0.1

export DB_NAME=refdb

export DB_USER=postgres

export DB_PASSWORD=yourpassword


