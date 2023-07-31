#!/usr/bin/env node

const { initNear } = require("./libs/near");

const nearAPI = require("near-api-js");

const Big = require("big.js");
const { keysToCamel, bigMin } = require("./libs/utils");
const { parseAsset } = require("./libs/asset");
const { parsePriceData } = require("./libs/priceData");
const { parseAccount, processAccount } = require("./libs/account");

const LogError = (message) => {
    console.log("\x1B[31mError:", message);
}

const LogInfo = (message) => {
    console.log(message);
}

async function predict(nearObjects) {
    if (!process.env.LIQUIDATION_ACCOUNT_ID) {
        LogError("Missing LIQUIDATION_ACCOUNT_ID");
        return;
    }
    const { burrowContract, priceOracleContract, NearConfig, account } = nearObjects;
    
    const rawAssets = keysToCamel(await burrowContract.get_assets_paged());

    const assets = rawAssets.reduce((assets, [assetId, asset]) => {
      assets[assetId] = parseAsset(asset);
      return assets;
    }, {});

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
    
    const limit = 100;

    const promises = [];
    for (let i = 0; i < numAccounts; i += limit) {
      promises.push(
        burrowContract.get_accounts_paged({ from_index: i, limit })
      );
    }
    const target_account = (await Promise.all(promises))
      .flat()
      .filter((a) => a.account_id == process.env.LIQUIDATION_ACCOUNT_ID)
      .map((a) => processAccount(parseAccount(a), assets, prices))
      .filter((a) => !!a.healthFactor)[0];

    if (!target_account) {
        LogError("Invalid LIQUIDATION_ACCOUNT_ID");
        return;
    }

    // if (target_account.discount.lte(NearConfig.minDiscount)) {
    //     LogError(`Invalid LIQUIDATION_ACCOUNT_ID, discount(${target_account.discount.mul(100).toFixed(2)}%) is too small! `);
    //     return;
    // }
    
    await predictComputeLiquidation(
      target_account,
      NearConfig.maxLiquidationAmount,
      NearConfig.maxWithdrawCount,
      NearConfig.burrowContractId,
      NearConfig.priceOracleContractId,
      account,
      NearConfig.minProfit,
    );

}

const recomputeAccountDiscount = (account) => {
    if (account.adjustedBorrowedSum && account.adjustedCollateralSum) {
      account.adjustedDebt = account.adjustedBorrowedSum.sub(
        account.adjustedCollateralSum
      );
      account.healthFactor = account.adjustedBorrowedSum.gt(0)
        ? account.adjustedCollateralSum.div(account.adjustedBorrowedSum)
        : Big(1e9);
      account.discount = account.adjustedDebt.gt(0)
        ? account.adjustedDebt.div(account.adjustedBorrowedSum).div(2)
        : Big(0);
    }
  };

const volatilityRatioCmp = (a, b) =>
  b.asset.config.volatilityRatio.cmp(a.asset.config.volatilityRatio);

async function predictComputeLiquidation(
    account,
    maxLiquidationAmount = Big(10).pow(18),
    maxWithdrawCount = 0,
    burrowContractId,
    priceOracleContractId,
    callerAccount,
    minProfit
  ) {
    // When liquidating, it's beneficial to take collateral with higher volatilityRatio first, because
    // it will decrease the adjustedCollateralSum less. Similarly it's more beneficial to
    // repay debt with higher volatilityRatio first, because it'll decrease adjustedBorrowedSum less.
    account.collateral.sort(volatilityRatioCmp);
    if (process.env.TAKE_COLLATERAL_PRIORITY) {
        for (const t of process.env.TAKE_COLLATERAL_PRIORITY.split(',').reverse()) {
            let index = account.collateral.findIndex((item) => item.tokenId == t)
            if (index == -1) {
                LogError("Invalid TAKE_COLLATERAL_PRIORITY");
                process.exit(-1)
            }
            let item = account.collateral.splice(index, 1)[0];
            account.collateral.unshift(item)
        }
    }
    LogInfo('');
    LogInfo('Take collateral order: ');
    account.collateral.forEach((a) => {
      LogInfo(a.tokenId + ': ' + a.balance.toFixed(0));
    });
    LogInfo('');

    account.borrowed.sort(volatilityRatioCmp);
    if (process.env.REPAY_BORROW_PRIORITY) {
        for (const t of process.env.REPAY_BORROW_PRIORITY.split(',').reverse()) {
            let index = account.borrowed.findIndex((item) => item.tokenId == t)
            if (index == -1) {
                LogError("Invalid REPAY_BORROW_PRIORITY");
                process.exit(-1)
            }
            let item = account.borrowed.splice(index, 1)[0];
            account.borrowed.unshift(item)
        }
    }

    LogInfo('');
    LogInfo('Repay borrowed order: ');
    account.borrowed.forEach((a) => {
      LogInfo(a.tokenId + ': ' + a.balance.toFixed(0));
    });
    LogInfo('');

    // LogInfo(JSON.stringify(account.collateral));
    // LogInfo(JSON.stringify(account.borrowed));
    // return;
    // Liquidation rules:
    // 1) Taken discounted collateral, should be less than the repaid debt
    // 2) The new health factor should still be less than 100%.
    // We can claim all collateral, but can't repay all debt.
  
    // Debt 100 DAI at 95% vol             -> 100$ deb -> 105.26$ adj debt
    // Collateral 7 NEAR at 20$ at 60% vol -> 140$ col -> 84$ adj col
    // Health factor: 0.798
    // Discount: 0.101
  
    const collateralAssets = [];
    const borrowedAssets = [];
  
    let collateralIndex = 0;
    let borrowedIndex = 0;
    const origHealth = account.healthFactor;
    const origDiscount = account.discount;
    const discountMul = Big(1).sub(account.discount);
    const maxHealthFactor = Big(995).div(1000);
    const minPricedBalance = Big(1).div(100);
    let totalPricedProfit = Big(0);
    let totalPricedAmount = Big(0);
    while (
      collateralIndex < account.collateral.length &&
      borrowedIndex < account.borrowed.length &&
      account.healthFactor.lt(maxHealthFactor) &&
      totalPricedAmount.lt(maxLiquidationAmount)
    ) {
      const collateral = account.collateral[collateralIndex];
  
      if (collateral.pricedBalance.lt(minPricedBalance)) {
        collateralIndex++;
        continue;
      }
  
      const borrowed = account.borrowed[borrowedIndex];
  
      if (borrowed.pricedBalance.lt(minPricedBalance) || !borrowed.asset.config.canBorrow) {
        borrowedIndex++;
        continue;
      }
  
      const discountedPricedBalance = collateral.pricedBalance.mul(discountMul);
      const maxPricedAmount = bigMin(
        bigMin(discountedPricedBalance, borrowed.pricedBalance),
        maxLiquidationAmount.sub(totalPricedAmount)
      );
      // Need to compute pricedAmount that the new health factor still less than 100%
      // adjColSum - X / discountMul * col_vol(60%) = adjBorSum - X / bor_vol(95%)
      // adjBorSum - adjColSum = X * 1 / bor_vol - X * col_vol / discountMul
      // adjBorSum - adjColSum = X * (1 / bor_vol - col_vol / discountMul)
      // X = (adjBorSum - adjColSum) / (1 / bor_vol - col_vol / discountMul)
      const denom = Big(1)
        .div(borrowed.asset.config.volatilityRatio)
        .sub(collateral.asset.config.volatilityRatio.div(discountMul));
      const maxHealthAmount = denom.gt(0)
        ? account.adjustedBorrowedSum
            .sub(account.adjustedCollateralSum)
            .div(denom)
        : maxPricedAmount.mul(2);
  
      const pricedAmount = bigMin(maxHealthAmount, maxPricedAmount);
      totalPricedAmount = totalPricedAmount.add(pricedAmount);
  
      const collateralPricedAmount = pricedAmount.div(discountMul);
  
      const pricedProfit = collateralPricedAmount.sub(pricedAmount);
      // console.log(
      //   `Profit $${collateralPricedAmount.toFixed(2)} of ${
      //     tokenIdToName(collateral.tokenId)
      //   } -> $${pricedAmount.toFixed(2)} of ${
      //     tokenIdToName(borrowed.tokenId)
      //   }: $${pricedProfit.toFixed(2)}`
      // );
      totalPricedProfit = totalPricedProfit.add(pricedProfit);
  
      const collateralAmount = collateralPricedAmount
        .div(collateral.price.multiplier)
        .mul(
          Big(10).pow(
            collateral.price.decimals + collateral.asset.config.extraDecimals
          )
        )
        .round(0, 0);
      const borrowedAmount = pricedAmount
        .div(borrowed.price.multiplier)
        .mul(
          Big(10).pow(
            borrowed.price.decimals + borrowed.asset.config.extraDecimals
          )
        )
        .round(0, 0);
  
      if (
        collateralAssets.length === 0 ||
        collateralAssets[collateralAssets.length - 1].tokenId !==
          collateral.tokenId
      ) {
        collateralAssets.push({
          tokenId: collateral.tokenId,
          amount: Big(0),
        });
      }
      const collateralAsset = collateralAssets[collateralAssets.length - 1];
      collateralAsset.amount = collateralAsset.amount.add(collateralAmount);
  
      if (
        borrowedAssets.length === 0 ||
        borrowedAssets[borrowedAssets.length - 1].tokenId !== borrowed.tokenId
      ) {
        borrowedAssets.push({
          tokenId: borrowed.tokenId,
          amount: Big(0),
        });
      }
      const borrowedAsset = borrowedAssets[borrowedAssets.length - 1];
      borrowedAsset.amount = borrowedAsset.amount.add(borrowedAmount);
  
      const adjustedCollateralAmount = collateralPricedAmount.mul(
        collateral.asset.config.volatilityRatio
      );
      const adjustedBorrowedAmount = pricedAmount.div(
        borrowed.asset.config.volatilityRatio
      );
  
      collateral.pricedBalance = collateral.pricedBalance.sub(
        collateralPricedAmount
      );
      collateral.adjustedPricedBalance = collateral.adjustedPricedBalance.sub(
        adjustedCollateralAmount
      );
      account.adjustedCollateralSum = account.adjustedCollateralSum.sub(
        adjustedCollateralAmount
      );
  
      borrowed.pricedBalance = borrowed.pricedBalance.sub(pricedAmount);
      borrowed.adjustedPricedBalance = borrowed.adjustedPricedBalance.sub(
        adjustedBorrowedAmount
      );
      account.adjustedBorrowedSum = account.adjustedBorrowedSum.sub(
        adjustedBorrowedAmount
      );
  
      recomputeAccountDiscount(account);
    }
    // console.log(
    //   `After liq: ${account.accountId} -> health ${account.healthFactor
    //     .mul(100)
    //     .toFixed(2)}% discount ${account.discount.mul(100).toFixed(2)}%`
    // );
    LogInfo(
      `Maybe liq ${account.accountId} -> discount ${origDiscount
        .mul(100)
        .toFixed(2)}% -> profit $${totalPricedProfit.toFixed(3)}`
    );
    // if (totalPricedProfit.lte(minProfit)) {
    //     LogError('Profit ' + totalPricedProfit + ' less than or equal to ' + minProfit);
    //     process.exit(-1)
    // }

    LogInfo('HealthFactor(adjustedCollateralSum / adjustedBorrowedSum) from ' + origHealth.toFixed(5) + ' to ' + account.healthFactor.toFixed(5));
    // if (origHealth.gte(account.healthFactor)) {
    //     LogError('HealthFactor reduced or unchanged!');
    //     process.exit(-1)
    // }

    // Adjusting collateralAssets amounts.
    collateralAssets.forEach((a) => {
      a.amount = a.amount.mul(9989).div(10000).round(0, 0);
    });
    borrowedAssets.forEach((a) => {
      a.amount = a.amount.mul(9990).div(10000).round(0, 0);
    });

    if (callerAccount.accountId) {
        await checkCallerBalance(callerAccount, borrowedAssets);
    }
  
    const liquidationAction = {
      account_id: account.accountId,
      in_assets: borrowedAssets.map((a) => ({
        token_id: a.tokenId,
        amount: a.amount.toFixed(0),
      })),
      out_assets: collateralAssets.map((a) => ({
        token_id: a.tokenId,
        amount: a.amount.toFixed(0),
      })),
    };
    const actions = {
      Execute: {
        actions: [
          {
            Liquidate: liquidationAction,
          },
          ...liquidationAction.out_assets
            .slice(0, maxWithdrawCount)
            .map(({ amount, token_id }) => ({
              Withdraw: {
                token_id,
                max_amount: amount,
              },
            })),
        ],
      },
    };
  
    LogInfo('');
    let caller_id = !callerAccount.accountId ? 'YOUR_ACCOUNT_ID' : callerAccount.accountId;
    let oracle_call_args = {
        receiver_id: burrowContractId,
        msg: JSON.stringify(actions),
      }
    LogInfo(
        '\x1B[92mnear call ' + 
        priceOracleContractId + ' oracle_call ' + 
        '\'' + JSON.stringify(oracle_call_args) + '\'' +
        ' --accountId ' + caller_id);
    LogInfo('');
    
  };

async function checkCallerBalance(callerAccount, borrowedAssets) {
    LogInfo("")
    LogInfo(callerAccount.accountId)
    for (const borrowedDetail of borrowedAssets) {
        const tokenContract = new nearAPI.Contract(
            callerAccount,
            borrowedDetail.tokenId,
            {
              viewMethods: [
                "ft_balance_of",
                "ft_metadata"
              ],
              changeMethods: [],
            }
          );
        let callerBalance = Big(await tokenContract.ft_balance_of({account_id: callerAccount.accountId}));
        let metadata = await tokenContract.ft_metadata({});
        LogInfo("TokenId: " + borrowedDetail.tokenId);
        LogInfo("Decimals:" + metadata.decimals);
        let amount_decimals = Big(10).pow(metadata.decimals >= 18 ? metadata.decimals : 18);
        LogInfo("Need:    " + borrowedDetail.amount.toFixed(0) + ' --> ' + borrowedDetail.amount.div(amount_decimals).toFixed(metadata.decimals));
        LogInfo("Current: " + callerBalance.toFixed(0));
        LogInfo(callerBalance.cmp(borrowedDetail.amount) >= 0 ? "" : "diff:    \x1B[31m" +  borrowedDetail.amount.sub(callerBalance).toFixed(0)  + ' --> ' + borrowedDetail.amount.sub(callerBalance).div(amount_decimals).toFixed(metadata.decimals));
        LogInfo("");
    }
}

initNear(false).then((nearObject) =>
    predict(nearObject)
);
