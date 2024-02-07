const Big = require("big.js");
const { bigMin } = require("./utils");

const volatilityRatioCmp = (a, b) =>
  b.volatilityRatio.cmp(a.volatilityRatio);

const parseAccountAsset = ([tokenId, shares]) => {
  return {
    tokenId,
    shares: Big(shares),
    balance: null,
  };
};

const parseAccountAssetDetailed = (a) => {
  return {
    tokenId: a.tokenId,
    shares: Big(a.shares),
    balance: a.balance ? Big(a.balance) : null,
  };
};

const parseAccount = (a) => {
  return Object.entries(a.positions).reduce((allPositions, [position, assetsInfo]) => {
    const position_type = position == "REGULAR" ? "RegularPosition" : "LPTokenPosition";
    allPositions.push({
      position,
      accountId: a.account_id,
      collateral: position == "REGULAR" ?
        Object.entries(assetsInfo[position_type].collateral).map(parseAccountAsset)
        : [parseAccountAsset([assetsInfo[position_type].lpt_id, assetsInfo[position_type].collateral])],
      borrowed: Object.entries(assetsInfo[position_type].borrowed).map(parseAccountAsset),
      supplied: Object.entries(a.supplied).map(parseAccountAsset),
    })
    return allPositions;
  }, []);
};

const parseAccountDetailed = (a) => {
  return {
    position: "REGULAR",
    accountId: a.accountId,
    collateral: a.collateral.map(parseAccountAssetDetailed),
    borrowed: a.borrowed.map(parseAccountAssetDetailed),
    supplied: a.supplied?.map(parseAccountAssetDetailed),
  };
};

const processAccountAsset = (a, assets, prices, supplied) => {
  const asset = assets[a.tokenId];
  const pool = supplied ? asset.supplied : asset.borrowed;
  const price = prices?.prices[a.tokenId];
  a.asset = asset;
  a.price = price;
  a.balance = pool.balance
    .mul(a.shares)
    .div(pool.shares)
    .round(0, supplied ? 0 : 3);
  a.tokenBalance = a.balance
    .div(Big(10).pow(asset.config.extraDecimals))
    .round(0, supplied ? 0 : 3);
  a.pricedBalance = price
    ? a.balance
        .mul(price.multiplier)
        .div(Big(10).pow(price.decimals + asset.config.extraDecimals))
    : null;
  a.adjustedPricedBalance = price
    ? supplied
      ? a.pricedBalance.mul(asset.config.volatilityRatio)
      : a.pricedBalance.div(asset.config.volatilityRatio)
    : null;
  a.volatilityRatio = asset.config.volatilityRatio;
  return a;
};

const processAccountAssetByLpInfo = (a, assets, prices, lp_token_infos, supplied) => {
  const asset = assets[a.tokenId];
  const pool = supplied ? asset.supplied : asset.borrowed;
  const unit_share_tokens = lp_token_infos?.[a.tokenId];
  a.asset = asset;
  a.price = {
    multiplier: Object.values(unit_share_tokens.tokens).reduce((sum, unit_share_token_value) => {
      const token_asset = assets[unit_share_token_value.token_id];
      const token_stdd_amount = Big(unit_share_token_value.amount).mul(Big(10).pow(token_asset.config.extraDecimals));
      const price = prices?.prices[unit_share_token_value.token_id];
      return sum.add(token_stdd_amount.mul(price.multiplier)
        .div(Big(10).pow(price.decimals + token_asset.config.extraDecimals)));
    }, Big(0)).mul(Big(10000)).round(0, 0),
    decimals: unit_share_tokens.decimals + 4
  }
  a.unit_share_tokens = unit_share_tokens;
  a.balance = pool.balance
    .mul(a.shares)
    .div(pool.shares)
    .round(0, supplied ? 0 : 3);
  a.tokenBalance = a.balance
    .div(Big(10).pow(asset.config.extraDecimals))
    .round(0, supplied ? 0 : 3);
  if (unit_share_tokens != undefined) {
    const unit_share = Big(10).pow(unit_share_tokens.decimals);
    a.pricedBalance = Object.values(unit_share_tokens.tokens).reduce((sum, unit_share_token_value) => {
      const token_asset = assets[unit_share_token_value.token_id];
      const token_stdd_amount = new Big(unit_share_token_value.amount).mul(Big(10).pow(token_asset.config.extraDecimals));
      const token_balance = Big(token_stdd_amount).mul(Big(a.balance)).div(Big(10).pow(asset.config.extraDecimals)).div(Big(unit_share)) ;
      const price = prices?.prices[unit_share_token_value.token_id];
      return sum.add(token_balance.mul(price.multiplier)
        .div(Big(10).pow(price.decimals + token_asset.config.extraDecimals)));
    }, Big(0));
    a.adjustedPricedBalance = Object.values(unit_share_tokens.tokens).reduce((sum, unit_share_token_value) => {
      const token_asset = assets[unit_share_token_value.token_id];
      const token_stdd_amount = new Big(unit_share_token_value.amount).mul(Big(10).pow(token_asset.config.extraDecimals));
      const token_balance = Big(token_stdd_amount).mul(Big(a.balance)).div(Big(10).pow(asset.config.extraDecimals)).div(Big(unit_share)) ;
      const price = prices?.prices[unit_share_token_value.token_id];
      return sum.add(token_balance.mul(price.multiplier)
        .div(Big(10).pow(price.decimals + token_asset.config.extraDecimals)).mul(token_asset.config.volatilityRatio));
    }, Big(0)).mul(asset.config.volatilityRatio);
    a.volatilityRatio = a.adjustedPricedBalance.div(a.pricedBalance).round(2, Big.roundDown);
  }
  return a;
};

const assetAdjustedPricedSum = (aa) =>
  aa.reduce(
    (acc, a) =>
      a.adjustedPricedBalance && acc ? acc.add(a.adjustedPricedBalance) : null,
    Big(0)
  );

const assetPricedSum = (aa) =>
  aa.reduce(
    (acc, a) => (a.pricedBalance && acc ? acc.add(a.pricedBalance) : null),
    Big(0)
  );

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

const processAccount = (account, assets, prices, lp_token_infos=undefined) => {
  account.collateral.forEach((a) => {
    if (account.position == "REGULAR") {
      processAccountAsset(a, assets, prices, true)
    } else {
      processAccountAssetByLpInfo(a, assets, prices, lp_token_infos, true)
    }
  });
  account.collateralSum = assetPricedSum(account.collateral);
  account.adjustedCollateralSum = assetAdjustedPricedSum(account.collateral);
  account.borrowed.forEach((a) =>
    processAccountAsset(a, assets, prices, false)
  );
  account.supplied?.forEach((a) =>
    processAccountAsset(a, assets, prices, true)
  );
  account.borrowedSum = assetPricedSum(account.borrowed);
  account.adjustedBorrowedSum = assetAdjustedPricedSum(account.borrowed);
  recomputeAccountDiscount(account);

  return account;
};

const computeLiquidation = (
  account,
  maxLiquidationAmount = Big(10).pow(18),
  maxWithdrawCount = 0,
  liquidator
) => {
  // When liquidating, it's beneficial to take collateral with higher volatilityRatio first, because
  // it will decrease the adjustedCollateralSum less. Similarly it's more beneficial to
  // repay debt with higher volatilityRatio first, because it'll decrease adjustedBorrowedSum less.
  account.collateral.sort(volatilityRatioCmp);
  account.borrowed.sort(volatilityRatioCmp);
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
    && liquidator.healthFactor >= 1
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
      .div(borrowed.volatilityRatio)
      .sub(collateral.volatilityRatio.div(discountMul));
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
      collateral.volatilityRatio
    );
    const adjustedBorrowedAmount = pricedAmount.div(
      borrowed.volatilityRatio
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


    liquidator.adjustedBorrowedSum = liquidator.adjustedBorrowedSum.add(adjustedBorrowedAmount)
    recomputeAccountDiscount(liquidator); // re-calculate liquidator's discount
  }
  // console.log(
  //   `After liq: ${account.accountId} -> health ${account.healthFactor
  //     .mul(100)
  //     .toFixed(2)}% discount ${account.discount.mul(100).toFixed(2)}%`
  // );
  console.log(
    `Maybe liq ${account.accountId} -> position ${account.position} -> discount ${origDiscount
      .mul(100)
      .toFixed(2)}% -> profit $${totalPricedProfit.toFixed(3)}`
  );

  // Adjusting collateralAssets amounts.
  collateralAssets.forEach((a) => {
    a.amount = a.amount.mul(9989).div(10000).round(0, 0);
  });
  borrowedAssets.forEach((a) => {
    a.amount = a.amount.mul(9990).div(10000).round(0, 0);
  });

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
    position: account.position ? account.position : null,
    min_token_amounts: account.position == "REGULAR" ? null : new Array(account.collateral[0].unit_share_tokens.tokens.length).fill("0")
  };
  
  const actions = [
    ...liquidationAction.in_assets.map(({ amount, token_id }) => ({
      Borrow: {
        token_id,
        amount: Big(amount).add(1000).toFixed(0), // Add small fraction to avoid rounding errors with shares.
      },
    })),
    {
      Liquidate: liquidationAction,
    },
    ...liquidationAction.out_assets
    .slice(0, account.position == "REGULAR" ? maxWithdrawCount : 0)
      .map(({ amount, token_id }) => ({
        Withdraw: {
          token_id,
          max_amount: amount,
        },
      })),
  ];

  // console.log(liquidationAction);
  return {
    actions,
    totalPricedProfit,
    origDiscount,
    origHealth,
    health: account.healthFactor,
  };
};

module.exports = {
  parseAccount,
  parseAccountDetailed,
  processAccount,
  computeLiquidation,
};
