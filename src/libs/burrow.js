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
const { exec } = require('node:child_process')

const FILENAME = "liquidated_list.json";

Big.DP = 27;

module.exports = {
  main: async (nearObjects, { liquidate = false, forceClose = false, export2db = false } = {}) => {
    const { burrowContract, priceOracleContract, NearConfig } = nearObjects;

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
      .map((a) => processAccount(parseAccount(a), assets, prices))
      .filter((a) => !!a.healthFactor);

    accounts.sort((a, b) => {
      return a.healthFactor.cmp(b.healthFactor);
    });

    console.log(
      accounts
        .filter((a) => a.healthFactor.lt(2))
        .map(
          (a) =>
            `${a.accountId} -> ${a.healthFactor
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

    if( export2db ){
        const liquidation_list = [];
        for(let i = 0; i < accountsWithDebt.length;i++){
           const liquidate_account = {}
           liquidate_account["account_id"] = accountsWithDebt[i].accountId;
           liquidate_account["healthFactor"] = accountsWithDebt[i].healthFactor;
           liquidate_account["discount"] = accountsWithDebt[i].discount;
           liquidate_account["collateralSum"] = accountsWithDebt[i].collateralSum.toFixed()
           liquidate_account["adjustedCollateralSum"] = accountsWithDebt[i].adjustedCollateralSum.toFixed()
           liquidate_account["borrowedSum"] = accountsWithDebt[i].borrowedSum.toFixed()
           liquidate_account["adjustedBorrowedSum"] = accountsWithDebt[i].adjustedBorrowedSum.toFixed()
           liquidate_account["collateral"] = accountsWithDebt[i]["collateral"].map((a) => ({
                                              tokenId:a.tokenId,
                                              shares:a.shares.toFixed(),
                                              balance:a.balance.toFixed(),
                                          }));
           liquidate_account["borrowed"] = accountsWithDebt[i]["borrowed"].map((a) => ({
                                            tokenId:a.tokenId,
                                            shares:a.shares.toFixed(),
                                            balance:a.balance.toFixed(),
                                        }));

           liquidation_list.push(liquidate_account);
        }
        const json_str = JSON.stringify(liquidation_list)
        //console.log(json_str);
        // post the data to REST api


        fs.writeFile("tmp.json", json_str, function (err) {
          if (err) {
            console.log(err);
          } else {
            // run the `cp` command using exec
            exec('cp ./tmp.json ./liquidated_list.json', (err, output) => {
              // once the command has completed, the callback function is called
              if (err) {
                  // log and return if we encounter an error
                  console.error("could not execute command: ", err)
                  return
              }
              // log the output received from the command
              console.log("Output: \n", output)
            })
            console.log(`File ${FILENAME} saved`);
          }
        });
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

    let bestLiquidation = null;
    if (liquidate) {
      for (let i = 0; i < accountsWithDebt.length; ++i) {
        const liquidation = computeLiquidation(
          accountsWithDebt[i],
          NearConfig.maxLiquidationAmount,
          NearConfig.maxWithdrawCount,
          burrowAccount
        );
        const { totalPricedProfit, origDiscount, origHealth, health } =
          liquidation;
        if (
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
        await priceOracleContract.oracle_call(
          {
            receiver_id: NearConfig.burrowContractId,
            msg,
          },
          Big(10).pow(12).mul(300).toFixed(0),
          "1"
        );
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
                  },
                },
              ],
            },
          });
          await priceOracleContract.oracle_call(
            {
              receiver_id: NearConfig.burrowContractId,
              msg,
            },
            Big(10).pow(12).mul(300).toFixed(0),
            "1"
          );

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
