const Big = require("big.js");
const axios = require("axios");
const { keysToCamel, printOutcome, sleep } = require("./utils");
const { parseAsset } = require("./asset");
const { getPythPrices, getPriceOralcePrices } = require("./priceData");
const { main: check_margin_position } = require("./margin");
const { main: check_stop_positions } = require("./stopKeeper");
const {
  parseAccount,
  parseAccountDetailed,
  processAccount,
  computeLiquidation,
  toAccount,
} = require("./account");
const log4js = require('log4js');
const liquidateLogger = log4js.getLogger();

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
    if (action.hasOwnProperty("Liquidate")) {
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
          const token_balance = Big(token_stdd_amount).mul(Big(a.amount)).div(Big(10).pow(asset.config.extraDecimals)).div(Big(unit_share));
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
  main: async (nearObjects, { liquidate = false, forceClose = false, marginLiquidate = false, marginForceClose = false, stopKeeper = false } = {}) => {
    liquidateLogger.info('Liquidate Begin');
    const { account, burrowContract, refFinanceContract, priceOracleContract, pythOracleContract, NearConfig } = nearObjects;
    const signerString = JSON.stringify(await burrowContract.get_account({
      account_id: NearConfig.accountId,
    }));
    if (signerString === 'null') {
      liquidateLogger.error(`${NearConfig.accountId} has not registered ${NearConfig.burrowContractId}`);
      return;
    }
    const rawAssets = keysToCamel(await burrowContract.get_assets_paged());
    const assets = rawAssets.reduce((assets, [assetId, asset]) => {
      assets[assetId] = parseAsset(asset);
      return assets;
    }, {});
    const burrow_config = await burrowContract.get_config();
    const prices = burrow_config.enable_price_oracle ? await getPriceOralcePrices(priceOracleContract, assets) : await getPythPrices(account, burrowContract, pythOracleContract);

    if (liquidate || forceClose) {
      let accounts;
      let lp_token_infos = await burrowContract.get_last_lp_token_infos();
      for (var shadow_token_id in lp_token_infos) {
        const pool_id = shadow_token_id.split("-")[1];
        const unit_share_token_amounts = await refFinanceContract.get_unit_share_token_amounts({ pool_id: parseInt(pool_id) })
        Object.entries(unit_share_token_amounts).forEach(([index, value]) => {
          lp_token_infos[shadow_token_id].tokens[index]['real_amount'] = value
        });
      }
      if (NearConfig.dataServiceUrl) {
        await axios.get(NearConfig.dataServiceUrl)
          .then(async response => {
            const responseData = JSON.parse(response.data.data.values)
            const timeDifference = Math.floor((new Date().getTime() - new Date(responseData.timestamp).getTime()) / 1000);
            if (timeDifference <= 60) {
              const allAccounts = responseData.data
                .map((a) => parseAccount(a))
                .flat()
                .map((a) => processAccount(a, assets, prices, lp_token_infos))
                .filter((a) => !!a.healthFactor)
                .filter(a => a.healthFactor.lt(1));

              if (NearConfig.minAdjustGap.gt(Big(0))) {
                allAccounts.sort((a, b) => {
                  return b.adjustedDebt.cmp(a.adjustedDebt);
                });
              } else {
                allAccounts.sort((a, b) => {
                  return a.healthFactor.cmp(b.healthFactor);
                });
              }

              const allAccountIds = [...new Set(allAccounts.slice(0, NearConfig.topN).map((item) => item.accountId))];
              const promises = [];
              for (const accountId of allAccountIds) {
                promises.push(
                  promiseWithTimeout(burrowContract.get_account_all_positions({ "account_id": accountId }), 20000)
                );
              }
              try {
                accounts = (await Promise.all(promises))
                  .flat()
                  .map((a) => toAccount(a))
                  .map((a) => parseAccount(a))
                  .flat()
                  .map((a) => processAccount(a, assets, prices, lp_token_infos))
                  .filter((a) => !!a.healthFactor)
                  .filter((a) => a.healthFactor.lt(1));
              } catch (error) {
                console.error('get_account_all_positions error:', error)
                return;
              }
            } else {
              console.error("Liquidatable accounts data is too stale, generated ", timeDifference + "s ago");
            }
          })
          .catch(error => {
            console.error("Get liquidatable accounts failed:", error);
          });
      } else {
        const numAccountsStr = await burrowContract.get_num_accounts();
        const numAccounts = parseInt(numAccountsStr);
        liquidateLogger.debug('numAccounts:', numAccounts);
        const limit = NearConfig.regularPagedLimit;
        const promises = [];
        for (let i = 0; i < numAccounts; i += limit) {
          promises.push(
            promiseWithTimeout(burrowContract.get_accounts_paged({ from_index: i, limit }), 20000)
          );
        }
        accounts = (await Promise.all(promises))
          .flat()
          .map((a) => parseAccount(a))
          .flat()
          .map((a) => processAccount(a, assets, prices, lp_token_infos))
          .filter((a) => !!a.healthFactor)
          .filter((a) => a.healthFactor.lt(1));
      }

      if (NearConfig.minAdjustGap.gt(Big(0))) {
        accounts.sort((a, b) => {
          return b.adjustedDebt.cmp(a.adjustedDebt);
        });
      } else {
        accounts.sort((a, b) => {
          return a.healthFactor.cmp(b.healthFactor);
        });
      }

      let accountsWithDebt = accounts.filter((a) =>
        a.discount.gte(NearConfig.minDiscount)
      );

      if (NearConfig.minAdjustGap.gt(Big(0))) {
        accountsWithDebt = accountsWithDebt.filter((a) =>
          a.adjustedDebt.gte(NearConfig.minAdjustGap)
        );
      }

      liquidateLogger.debug(`Accounts with health less than 100 and discount greater than or equal to ${NearConfig.minDiscount}% and adjustedDebt greater than or equal to ${NearConfig.minAdjustGap}$, order by ${NearConfig.minAdjustGap.gt(Big(0)) ? 'adjustedDebt' : 'discount'}:`,
        accountsWithDebt
          .filter((a) => a.healthFactor.lt(2))
          .map(
            (a) =>
              `${a.accountId} ${a.position}-> healthFactor: ${a.healthFactor
                .mul(100)
                .toFixed(2)}% -> discount: ${a.discount.mul(100).toFixed(2)}% -> borrowedSum: $${a.borrowedSum.toFixed()} -> adjustedDebt: $${a.adjustedDebt.toFixed(2)}`
          )
      );

      let bestLiquidation = null;
      if (liquidate) {
        const signerAccount = processAccount(
          parseAccountDetailed(
            keysToCamel(
              JSON.parse(signerString)
            )
          ),
          assets,
          prices
        );
        // const maxLiquidationAmount = signerAccount.adjustedCollateralSum.sub(signerAccount.adjustedBorrowedSum);
        // if (maxLiquidationAmount.lte(Big(0))) {
        //   liquidateLogger.error("signer account maxLiquidationAmount <= 0");
        //   return;
        // }
        if (signerAccount.healthFactor != undefined && signerAccount.healthFactor.lt(NearConfig.stopLiquidationHealthFactor)) {
          liquidateLogger.error("signer account healthFactor is", signerAccount.healthFactor.toFixed(0), ", wait rebalance");
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
            NearConfig.maxLiquidationAmount,
            NearConfig.maxWithdrawCount,
            burrowAccount
          );
          if (burrowAccount.healthFactor != undefined && burrowAccount.healthFactor.lt(Big(1))) {
            liquidateLogger.error("signer account not enough collateral");
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
          liquidateLogger.debug("Executing liquidation");
          liquidateLogger.debug("actions: ", JSON.stringify(bestLiquidation.actions));
          try {
            const outcome = burrow_config.enable_price_oracle ?
              await execute_with_price_oracle(account, NearConfig, bestLiquidation.actions) :
              await execute_with_pyth_oracle(account, NearConfig, bestLiquidation.actions);
            printOutcome("normal liquidation", "./logs/liquidation_success.log", outcome);
          } catch (Error) {
            liquidateLogger.error("Error: ", Error)
          }
        }
      }
      if (forceClose) {
        for (let i = 0; i < accountsWithDebt.length; ++i) {
          const accountDetail = accountsWithDebt[i];
          if (accountDetail.collateralSum.lt(accountDetail.borrowedSum)) {
            liquidateLogger.debug("Executing force closing of account", accountDetail.accountId);
            const actions = [
              {
                ForceClose: {
                  account_id: accountDetail.accountId,
                  position: accountDetail.position ? accountDetail.position : null,
                  min_token_amounts: accountDetail.position == "REGULAR" ? null : new Array(accountDetail.collateral[0].unit_share_tokens.tokens.length).fill("0")
                },
              },
            ];
            liquidateLogger.debug("actions: ", JSON.stringify(actions));

            try {
              const outcome = burrow_config.enable_price_oracle ?
                await execute_with_price_oracle(account, NearConfig, actions) :
                await execute_with_pyth_oracle(account, NearConfig, actions);
              printOutcome("normal force_close", "./logs/force_close_success.log", outcome);
            } catch (Error) {
              liquidateLogger.error("Error: ", Error)
            }
            break;
          }
        }
      }
    }
    // Fetch margin accounts once for both margin liquidation and stop keeper
    if (marginLiquidate || marginForceClose || stopKeeper) {
      // Check liquidator registration
      const liquidator = await burrowContract.get_margin_account({ account_id: NearConfig.accountId });
      if (!liquidator) {
        liquidateLogger.error(`${NearConfig.accountId} has not registered margin account on ${NearConfig.burrowContractId}`);
      } else {
        // Fetch all margin accounts (paginated)
        const numAccountsStr = await burrowContract.get_num_margin_accounts();
        const numAccounts = parseInt(numAccountsStr);
        liquidateLogger.debug("Num margin accounts:", numAccounts);

        const limit = NearConfig.marginPagedLimit;
        const promises = [];
        for (let i = 0; i < numAccounts; i += limit) {
          promises.push(burrowContract.get_margin_accounts_paged({ from_index: i, limit }));
        }
        const rawMarginAccounts = (await Promise.all(promises)).flat();

        // Run margin liquidation/forceclose
        if (marginLiquidate || marginForceClose) {
          await check_margin_position(account, burrow_config, NearConfig, burrowContract, assets, prices, marginLiquidate, marginForceClose, liquidator, rawMarginAccounts)
            .catch(error => {
              console.error("check_margin_position failed:", error);
            });
        }

        // Run stop keeper
        if (stopKeeper) {
          await check_stop_positions(account, burrow_config, NearConfig, burrowContract, assets, prices, liquidator, rawMarginAccounts)
            .catch(error => {
              console.error("check_stop_positions failed:", error);
            });
        }
      }
    }
  },
};
