# Burrow Liquidation Bot
### Build
```bash
npm install
```

### Prepare Bot Account
The bot will check debt info from Burrow and try to liquidate them to earn profits through Ref-exchange and Ref-DCL (in case of some margin positions).  
So, the bot needs to register to those tokens involved and the burrow contract.  
Use `reg_liquidator.example.sh` to help you for those tedious work:
```
# Modify the shell according to your env:
cp reg_liquidator.example.sh reg_liquidator.sh
vim reg_liquidator.sh
# change NEAR_ACCOUNT_ID to the account used for signing.
# change TARGET_NEAR_ACCOUNT_ID to the bot account for those registrations.
# check example file for other configurable params.

bash reg_liquidator.sh
```

### Prepare rebalance for the bot
When liquidating regular debts, the bot will borrow and repay debt to get discounted collaterals. So, the bot would hold his own debt too for a successful liquidation.  
The rebalance is to repay bot's own debts. The way to do that is, the rebalance would have those non-wnear assets sold in ref exchange to uniformed wnear assts. Then buy those tokens need to repay using wnear, and actually repay them.  

the example file `rebalance.example.sh` shows how to configure and run your rebalance.
```
# Modify the shell according to your env:
cp rebalance.example.sh rebalance.sh
vim rebalance.sh
# check example file for all configurable params.

bash rebalance.sh
```

### Configure and Run your bot
Actually there are four switchs you can use: 
- regular debt liquidation,
- regular debt force close,
- margin trading position liquidation,
- margin trading position force close.

You can enable any one and any combination of them.  
Need to note: if you turn on regular debt liquidation, remember to supply some assets in the burrow as collateral, otherwise it won't work.  

the example file `run.example.sh` shows how to configure and run your bot， take it as reference to make your own shell.
```
# Modify the shell according to your env:
cp run.example.sh run.sh
vim run.sh
# check example file for all configurable params.

bash run.sh
```

