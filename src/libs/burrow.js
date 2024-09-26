const Big = require("big.js");
const axios = require("axios");
const { keysToCamel, logToFile, PYTH_STALENESS_THRESHOLD } = require("./utils");
const { parseAsset } = require("./asset");
const { parsePriceData } = require("./priceData");
const { main: check_margin_position } = require("./margin");
const {
  parseAccount,
  parseAccountDetailed,
  processAccount,
  computeLiquidation,
  toAccount,
} = require("./account");
const { Near } = require("near-api-js");

const fs = require("fs");
const { exec } = require('child_process')
const request = require("request")
const liquidationlog_model = require('./models/liquidation_log');
const seq = require('./models/db');

const FILENAME = "liquidated_list.json";

Big.DP = 27;

const promiseWithTimeout = (promise, timeout) => {
  let timeoutPromise = new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error('Promise timed out'));
    }, timeout);
  });
 
  return Promise.race([promise, timeoutPromise]);
}

const calcRealPricedProfit = (actions, assets, prices, lp_token_infos) => {
  for (const action of actions) {
    if(action.hasOwnProperty("Liquidate")){
      const inPrice = action["Liquidate"]["in_assets"].reduce((sum, a) => {
        const asset = assets[a.token_id];
        const price = prices.prices[a.token_id];
        return sum.add(Big(a.amount).mul(price.multiplier)
                  .div(Big(10).pow(price.decimals + asset.config.extraDecimals)));
      }, Big(0));
      if (action['Liquidate']['position'] == "REGULAR") {
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
          min_token_amounts.push(token_balance.div(Big(10).pow(token_asset.config.extraDecimals)).mul(Big("0.95")).toFixed(0));
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

const getPythPrices = async (account, burrowContract, pythOracleContract) => {
  const token_pyth_infos = await burrowContract.get_all_token_pyth_infos();
  let prices = {};
  for (const [assetId, pythInfo] of Object.entries(token_pyth_infos)) {
    if (pythInfo.default_price == null) {
      let pythPrice = await pythOracleContract.get_price_no_older_than({"price_id": pythInfo.price_identifier, "age": PYTH_STALENESS_THRESHOLD});
      // console.log(JSON.stringify(pythPrice, undefined, 2));
      if (pythInfo.extra_call == null) {
        prices[assetId] = {
          "multiplier": Big(pythPrice.price).mul(Big(10).pow(pythPrice.expo)).mul(Big(10).pow(pythInfo.fraction_digits)).round(0),
          "decimals": pythInfo.fraction_digits + pythInfo.decimals
        };
      } else {
        let price = await account.viewFunction(assetId, pythInfo.extra_call, {});
        prices[assetId] = {
          "multiplier": Big(pythPrice.price).mul(Big(10).pow(pythPrice.expo)).mul(Big(price)).div(Big(10).pow(24)).mul(Big(10).pow(pythInfo.fraction_digits)).round(0),
          "decimals": pythInfo.fraction_digits + pythInfo.decimals
        };
      }
    } else {
      prices[assetId] = {
        "multiplier": Big(pythInfo.default_price.multiplier),
        "decimals": pythInfo.default_price.decimals
      }
    }
  }
  return {"prices": prices}
}

const getPriceOralcePrices = async (priceOracleContract, assets) => {
  const rawPriceData = keysToCamel(await priceOracleContract.get_price_data({
    asset_ids: Object.keys(assets),
  }));
  return parsePriceData(rawPriceData)
}

const execute_with_price_oracle = async (account, NearConfig, actions) => {
  const msg = JSON.stringify({
    Execute: {
      actions
    }
  });
  return await account.functionCall({
    "contractId": NearConfig.priceOracleContractId,
    "methodName": "oracle_call",
    "args": {
      "receiver_id": NearConfig.burrowContractId,
      "msg": msg,
    },
    "gas": Big(10).pow(12).mul(300).toFixed(0),
    "attachedDeposit": "1",
  });
}

const execute_with_pyth_oracle = async (account, NearConfig, actions) => {
  return await account.functionCall({
    "contractId": NearConfig.burrowContractId,
    "methodName": "execute_with_pyth",
    "args": {
      actions
    },
    "gas": Big(10).pow(12).mul(300).toFixed(0),
    "attachedDeposit": "1",
  });
}

module.exports = {
  main: async (nearObjects, { liquidate = false, forceClose = false, marginPosition = false } = {}) => {
    console.log(new Date())
    const { account, burrowContract, refFinanceContract, priceOracleContract, pythOracleContract, NearConfig } = nearObjects;

    axios.get(`${NearConfig.dataServiceUrl}/get-liquidation-result?key=LiquidatableAccounts`)
      .then(async response => {
        const responseData = JSON.parse(response.data.data.values)
        const timeDifference = Math.floor((new Date().getTime() - new Date(responseData.timestamp).getTime()) / 1000);
        if (timeDifference <= 60) {
          const rawAssets = keysToCamel(await burrowContract.get_assets_paged());
          const assets = rawAssets.reduce((assets, [assetId, asset]) => {
            assets[assetId] = parseAsset(asset);
            return assets;
          }, {});

          let lp_token_infos = await burrowContract.get_last_lp_token_infos();
          for (var shadow_token_id in lp_token_infos) {
            const pool_id = shadow_token_id.split("-")[1];
            const unit_share_token_amounts = await refFinanceContract.get_unit_share_token_amounts({ pool_id: parseInt(pool_id) })
            Object.entries(unit_share_token_amounts).forEach(([index, value]) => {
              lp_token_infos[shadow_token_id].tokens[index]['real_amount'] = value
            });
          }

          const burrow_config = await burrowContract.get_config();
          const prices = burrow_config.enable_price_oracle ? await getPriceOralcePrices(priceOracleContract, assets) : await getPythPrices(account, burrowContract, pythOracleContract);

          const allAccounts = responseData.data
            .map((a) => parseAccount(a))
            .flat()
            .map((a) => processAccount(a, assets, prices, lp_token_infos))
            .filter((a) => !!a.healthFactor)
            .filter(a => a.healthFactor.lt(1));
          
          allAccounts.sort((a, b) => {
            return a.healthFactor.cmp(b.healthFactor);
          }); 

          const allAccountIds = [...new Set(allAccounts.slice(0, NearConfig.topN).map((item) => item.accountId))];
          const promises = [];
          for (const accountId of allAccountIds) {
            promises.push(
              promiseWithTimeout(burrowContract.get_account_all_positions({"account_id":accountId}), 20000)
            );
          }

          let accounts;
          try {
            accounts = (await Promise.all(promises))
              .flat()
              .map((a) => toAccount(a))
              .map((a) => parseAccount(a))
              .flat()
              .map((a) => processAccount(a, assets, prices, lp_token_infos))
              .filter((a) => !!a.healthFactor)
              .filter(a => a.healthFactor.lt(1));
          } catch (error) {
            console.error('get_account_all_positions error:', error)
            return;
          }

          accounts.sort((a, b) => {
            return a.healthFactor.cmp(b.healthFactor);
          });

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

          const accountsWithDebt = accounts.filter((a) =>
            a.discount.gte(NearConfig.minDiscount)
          );

          console.log(`Accounts with health less than 100 and discount greater than or equal to ${NearConfig.minDiscount}:`,
            accountsWithDebt
              .filter((a) => a.healthFactor.lt(2))
              .map(
                (a) =>
                  `${a.accountId} ${a.position}-> healthFactor: ${a.healthFactor
                    .mul(100)
                    .toFixed(2)}% -> discount: ${a.discount.mul(100).toFixed(2)}% -> borrowedSum: $${a.borrowedSum.toFixed()}`
              )
              .slice(0, 20)
          );

          let bestLiquidation = null;
          if (liquidate) {
            const signerString = JSON.stringify(await burrowContract.get_account({
              account_id: NearConfig.accountId,
            }));
            const signerAccount = processAccount(
              parseAccountDetailed(
                keysToCamel(
                  JSON.parse(signerString)
                )
              ),
              assets,
              prices
            );
            const maxLiquidationAmount = signerAccount.adjustedCollateralSum.sub(signerAccount.adjustedBorrowedSum);
            if (maxLiquidationAmount.lte(Big(0))) {
              console.log("signer account maxLiquidationAmount <= 0");
              return;
            }
            for (let i = 0; i < accountsWithDebt.length; ++i) {
              if (accountsWithDebt[i].accountId == NearConfig.accountId) {
                continue;
              }
              const burrowAccount = processAccount(
                parseAccountDetailed(
                  keysToCamel(
                    JSON.parse(signerString)
                  )
                ),
                assets,
                prices
              );
              const liquidation = computeLiquidation(
                accountsWithDebt[i],
                maxLiquidationAmount,
                NearConfig.maxWithdrawCount,
                burrowAccount
              );
              if (burrowAccount.healthFactor != undefined && burrowAccount.healthFactor.lt(Big(1))) {
                console.log("signer account not enough collateral");
                continue;
              }
              const { actions, totalPricedProfit, origDiscount, origHealth, health } =
                liquidation;
              if (
                totalPricedProfit.lte(NearConfig.minProfit) ||
                origDiscount.lte(NearConfig.minDiscount) ||
                origHealth.gte(health)
              ) {
                continue;
              }
              if (calcRealPricedProfit(actions, assets, prices, lp_token_infos).lte(NearConfig.minProfit)) {
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
              console.log("actions: ", JSON.stringify(bestLiquidation.actions));
              try {
                const outcome = burrow_config.enable_price_oracle ?
                  await execute_with_price_oracle(account, NearConfig, bestLiquidation.actions) :
                  await execute_with_pyth_oracle(account, NearConfig, bestLiquidation.actions);
                printOutcome(outcome);
              } catch (Error) {
                console.log("Error: ", Error)
              }
            }
          }
          if (forceClose) {
            for (let i = 0; i < accountsWithDebt.length; ++i) {
              const accountDetail = accountsWithDebt[i];
              if (accountDetail.collateralSum.lt(accountDetail.borrowedSum)) {
                console.log("Executing force closing of account", accountDetail.accountId);
                const actions = [
                  {
                    ForceClose: {
                      account_id: accountDetail.accountId,
                      position: accountDetail.position ? accountDetail.position : null,
                      min_token_amounts: accountDetail.position == "REGULAR" ? null : new Array(accountDetail.collateral[0].unit_share_tokens.tokens.length).fill("0")
                    },
                  },
                ];
                console.log("actions: ", JSON.stringify(actions));

                try {
                  const outcome = burrow_config.enable_price_oracle ?
                    await execute_with_price_oracle(account, NearConfig, actions) :
                    await execute_with_pyth_oracle(account, NearConfig, actions);
                  printOutcome(outcome);
                } catch (Error) {
                  console.log("Error: ", Error)
                }
                break;
              }
            }
          }

          if (marginPosition) {
            await check_margin_position(account, burrow_config, NearConfig, burrowContract, assets, prices);
          }
        } else {
          console.error("Liquidatable accounts data is too stale, generated ", timeDifference + "s ago");
        }
      })
      .catch(error => {
        console.error("Get liquidatable accounts failed:", error);
      });
  },
};
