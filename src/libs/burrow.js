const Big = require("big.js");
const { keysToCamel } = require("./utils");
const { parseAsset } = require("./asset");
const { parsePriceData } = require("./priceData");
const {
  parseAccount,
  parseAccountDetailed,
  processAccount,
  computeLiquidation,
} = require("./account");
const { Near } = require("near-api-js");

const fs = require("fs");
const { exec } = require('child_process')
const request = require("request")
const liquidationlog_model = require('./models/liquidation_log');
const seq = require('./models/db');

const FILENAME = "liquidated_list.json";

Big.DP = 27;

const calcRealPricedProfit = (actions, assets, prices, lp_token_infos) => {
  for (const action of actions.Execute.actions) {
    if(action.hasOwnProperty("Liquidate")){
      const inPrice = action["Liquidate"]["in_assets"].reduce((sum, a) => {
        const asset = assets[a.token_id];
        const price = prices.prices[a.token_id];
        return sum.add(Big(a.amount).mul(price.multiplier)
                  .div(Big(10).pow(price.decimals + asset.config.extraDecimals)));
      }, Big(0));
      if (action['position'] == "REGULAR") {
        const outPrice = action["Liquidate"]["out_assets"].reduce((sum, a) => {
          const asset = assets[a.token_id];
          const price = prices.prices[a.token_id];
          return sum.add(Big(a.amount).mul(price.multiplier)
                  .div(Big(10).pow(price.decimals + asset.config.extraDecimals)));
        }, Big(0));
        return outPrice.sub(inPrice)
      } else {
        const a = action["Liquidate"]["out_assets"][0];
        const asset = assets[a.token_id];
        const unit_share_tokens = lp_token_infos[a.token_id];
        const unit_share = Big(10).pow(unit_share_tokens.decimals);
        let min_token_amounts = []
        const outPrice = Object.values(unit_share_tokens.tokens).reduce((sum, unit_share_token_value) => {
          const token_asset = assets[unit_share_token_value.token_id];
          const token_stdd_amount = new Big(unit_share_token_value.real_amount).mul(Big(10).pow(token_asset.config.extraDecimals));
          const token_balance = Big(token_stdd_amount).mul(Big(a.amount)).div(Big(10).pow(asset.config.extraDecimals)).div(Big(unit_share)) ;
          const price = prices.prices[unit_share_token_value.token_id];
          min_token_amounts.push(token_stdd_amount.div(Big(10).pow(token_asset.config.extraDecimals)).toFixed(0));
          return sum.add(token_balance.mul(price.multiplier)
            .div(Big(10).pow(price.decimals + token_asset.config.extraDecimals)));
        }, Big(0));
        action["Liquidate"]["min_token_amounts"] = min_token_amounts
        return outPrice.sub(inPrice)
      }
    }
  }
  return 0;
}

module.exports = {
  main: async (nearObjects, { liquidate = false, forceClose = false, export2db = false } = {}) => {
    const { burrowContract, refFinanceContract, priceOracleContract, NearConfig } = nearObjects;

    const rawAssets = keysToCamel(await burrowContract.get_assets_paged());
    const assets = rawAssets.reduce((assets, [assetId, asset]) => {
      assets[assetId] = parseAsset(asset);
      return assets;
    }, {});
    // console.log(assets);

    const [rawPriceData, numAccountsStr] = (
      await Promise.all([
        priceOracleContract.get_price_data({
          asset_ids: Object.keys(assets),
        }),
        burrowContract.get_num_accounts(),
      ])
    ).map(keysToCamel);

    let lp_token_infos = await burrowContract.get_last_lp_token_infos();
    for (var shadow_token_id in lp_token_infos) {
      const pool_id = shadow_token_id.split("-")[1];
      const unit_share_token_amounts = await refFinanceContract.get_unit_share_token_amounts({pool_id: parseInt(pool_id)})
      Object.entries(unit_share_token_amounts).forEach(([index, value]) => {
        lp_token_infos[shadow_token_id].tokens[index]['real_amount'] = value
      });
    }

    const numAccounts = parseInt(numAccountsStr);

    const prices = parsePriceData(rawPriceData);

    console.log("Num accounts: ", numAccounts);
    // Due to upgrade to 0.7.0, the supplied are returned from state.
    const limit = 40;

    const promises = [];
    for (let i = 0; i < numAccounts; i += limit) {
      promises.push(
        burrowContract.get_accounts_paged({ from_index: i, limit })
      );
    }
    const accounts = (await Promise.all(promises))
      .flat()
      .map((a) => parseAccount(a))
      .flat()
      .map((a) => processAccount(a, assets, prices, lp_token_infos))
      .filter((a) => !!a.healthFactor);

    accounts.sort((a, b) => {
      return a.healthFactor.cmp(b.healthFactor);
    });

    console.log(
      accounts
        .filter((a) => a.healthFactor.lt(2))
        .map(
          (a) =>
            `${a.accountId} ${a.position}-> ${a.healthFactor
              .mul(100)
              .toFixed(2)}% -> $${a.borrowedSum.toFixed(2)}`
        )
        .slice(0, 20)
    );

    if (NearConfig.showWhales) {
      console.log(
        accounts
          .sort((a, b) => b.borrowedSum.sub(a.borrowedSum).toNumber())
          .map(
            (a) =>
              `${a.accountId} -> ${a.healthFactor
                .mul(100)
                .toFixed(2)}% -> $${a.borrowedSum.toFixed(2)}`
          )
          .slice(0, 20)
      );
    }
    // console.log(JSON.stringify(accounts, undefined, 2));

    const accountsWithDebt = accounts.filter((a) =>
      a.discount.gte(NearConfig.minDiscount)
    );

    accountsWithDebt.sort((a, b) => {
      return b.discount.cmp(a.discount);
    });

    // select those whose healthFactor less than 2
    if( export2db ){
        const liquidation_list = [];
        for(let i = 0; i < accounts.length;i++){
           if(parseFloat(accounts[i].healthFactor) > 2.0) continue;
           const liquidate_account = {}
           liquidate_account["account_id"] = accounts[i].accountId;
           liquidate_account["healthFactor"] = accounts[i].healthFactor;
           liquidate_account["discount"] = accounts[i].discount;
           liquidate_account["collateralSum"] = accounts[i].collateralSum.toFixed()
           liquidate_account["adjustedCollateralSum"] = accounts[i].adjustedCollateralSum.toFixed()
           liquidate_account["borrowedSum"] = accounts[i].borrowedSum.toFixed()
           liquidate_account["adjustedBorrowedSum"] = accounts[i].adjustedBorrowedSum.toFixed()
           liquidate_account["collateral"] = accounts[i]["collateral"].map((a) => ({
                                              tokenId:a.tokenId,
                                              shares:a.shares.toFixed(),
                                              balance:a.balance.toFixed(),
                                          }));
           liquidate_account["borrowed"] = accounts[i]["borrowed"].map((a) => ({
                                            tokenId:a.tokenId,
                                            shares:a.shares.toFixed(),
                                            balance:a.balance.toFixed(),
                                        }));

           liquidation_list.push(liquidate_account);
        }
        const json_str = JSON.stringify(liquidation_list)
        //console.log(json_str);
        
        // post the data to REST api
        request({
            url: "https://mainnet-indexer.ref-finance.com/add-burrow-liquidation-result",
            method: "POST",
            headers: { "content-type": "application/json", },
            json: liquidation_list
        }, function (error, response, body) {
            if (!error && response.statusCode === 200) {
                // console.log(body)
            }
            else {
                console.log("error: " + error)
                console.log("response.statusCode: " + response.statusCode)
                console.log("response.statusText: " + response.statusText)
            }
        })


        fs.writeFile("./data/tmp.json", json_str, function (err) {
          if (err) {
            console.log(err);
          } else {
            // run the `cp` command using exec
            exec('cp ./data/tmp.json ./data/liquidated_list.json', (err, output) => {
              // once the command has completed, the callback function is called
              if (err) {
                  // log and return if we encounter an error
                  console.error("could not execute command: ", err)
                  return
              }
              // log the output received from the command
              // console.log("Output: \n", output)
            })
            console.log(`File ${FILENAME} saved`);
          }
        });
    }

    let bestLiquidation = null;
    if (liquidate) {
      for (let i = 0; i < accountsWithDebt.length; ++i) {
        if (accountsWithDebt[i].accountId == NearConfig.accountId) {
          continue;
        }
        // read liquidator account from burrowland
        const burrowAccount = processAccount(
          parseAccountDetailed(
            keysToCamel(
              await burrowContract.get_account({
                account_id: NearConfig.accountId,
              })
            )
          ),
          assets,
          prices
        );
        const liquidation = computeLiquidation(
          accountsWithDebt[i],
          NearConfig.maxLiquidationAmount,
          NearConfig.maxWithdrawCount,
          burrowAccount
        );
        if (burrowAccount.healthFactor.lt(Big(1))) {
          console.log("signer account not enough collateral");
          continue;
        }
        const { actions, totalPricedProfit, origDiscount, origHealth, health } =
          liquidation;
        let realPricedProfit = calcRealPricedProfit(actions, assets, prices, lp_token_infos);
        if (
          realPricedProfit.lte(NearConfig.minProfit) ||
          totalPricedProfit.lte(NearConfig.minProfit) ||
          origDiscount.lte(NearConfig.minDiscount) ||
          origHealth.gte(health)
        ) {
          continue;
        }
        if (
          !bestLiquidation ||
          totalPricedProfit.gt(bestLiquidation.totalPricedProfit)
        ) {
          bestLiquidation = liquidation;
        }
      }
      if (bestLiquidation) {
        console.log("Executing liquidation");
        const msg = JSON.stringify(bestLiquidation.actions);
        console.log("liquidate", JSON.stringify(msg));
        try {
          const outcome = await nearObjects.account.functionCall(
            NearConfig.priceOracleContractId,
            "oracle_call",
            {
              receiver_id: NearConfig.burrowContractId,
              msg,
            },
            Big(10).pow(12).mul(300).toFixed(0),
            "1",
          );
          let is_success = Object.values(outcome['receipts_outcome']).reduce((is_success, receipt) => {
            if (receipt["outcome"]["status"].hasOwnProperty("Failure")) {
              return false;
            }
            return is_success;
          }, true);
          if (is_success) {
            for (const action of bestLiquidation.actions.Execute.actions) {
              if(action.hasOwnProperty("Liquidate")){
                await liquidationlog_model.create({
                  account_id: action["Liquidate"].account_id,
                  healthFactor_before: bestLiquidation.origHealth.toFixed(6),
                  healthFactor_after: bestLiquidation.health.toFixed(6),
                  liquidation_type: "liquidate",
                  RepaidAssets: action["Liquidate"].in_assets,
                  LiquidatedAssets: action["Liquidate"].out_assets,
                  isRead: false,
                  isDeleted: false
                });
              }
            }
          }
        }
        catch (Error) {
          console.log("Error: ",Error)
        }
      }
    }
    if (forceClose) {
      for (let i = 0; i < accountsWithDebt.length; ++i) {
        const account = accountsWithDebt[i];
        if (account.collateralSum.lt(account.borrowedSum)) {
          console.log("Executing force closing of account", account.accountId);
          const msg = JSON.stringify({
            Execute: {
              actions: [
                {
                  ForceClose: {
                    account_id: account.accountId,
                    position: account.position ? account.position : null,
                    min_token_amounts: account.position == "REGULAR" ? null : new Array(account.collateral[0].unit_share_tokens.tokens.length).fill("0")
                  },
                },
              ],
            },
          });
          console.log("force closing", account.position, JSON.stringify(msg));
          
          try {
            const outcome = await nearObjects.account.functionCall(
              NearConfig.priceOracleContractId,
              "oracle_call",
              {
                receiver_id: NearConfig.burrowContractId,
                msg,
              },
              Big(10).pow(12).mul(300).toFixed(0),
              "1",
            );
            let is_success = Object.values(outcome['receipts_outcome']).reduce((is_success, receipt) => {
              if (receipt["outcome"]["status"].hasOwnProperty("Failure")) {
                return false;
              }
              return is_success;
            }, true);
            if (is_success) {
              await liquidationlog_model.create({
                account_id: account.accountId,
                healthFactor_before: account.healthFactor.toFixed(6),
                healthFactor_after: "100000",
                liquidation_type: "ForceClose",
                RepaidAssets: [],
                LiquidatedAssets: [],
                isRead: false,
                isDeleted: false
              });
            }
          }
          catch (Error) {
             console.log("Error: ",Error)
          }
          return;
        }
      }
    }

    return {
      numAccounts,
      accounts: JSON.stringify(accounts, undefined, 2),
      accountsWithDebt: JSON.stringify(accountsWithDebt, undefined, 2),
    };
  },
};
