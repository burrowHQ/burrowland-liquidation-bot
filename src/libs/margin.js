const Big = require("big.js");
const { parseRatio, printOutcome, getRefExchangeSwapMsg, getSwapActionsMinAmountOut } = require("./utils");
const log4js = require('log4js');

const liquidateLogger = log4js.getLogger();

const parseAccount = (a) => {
  return Object.entries(a.margin_positions).reduce((allPositions, [position, positionInfo]) => {
    allPositions.push({
      accountId: a.account_id,
      position,
      uahpi_at_open: Big(positionInfo.uahpi_at_open),
      debt_cap: Big(positionInfo.debt_cap),
      token_c_info: {
        token_id: positionInfo.token_c_info.token_id,
        balance: Big(positionInfo.token_c_info.balance),
      },
      token_d_info: {
        token_id: positionInfo.token_d_info.token_id,
        balance: Big(positionInfo.token_d_info.balance),
      },
      token_p_id: positionInfo.token_p_id,
      token_p_amount: Big(positionInfo.token_p_amount),
      is_locking: positionInfo.is_locking,
    })
    return allPositions;
  }, []);
};

const updateActions = (actions, amount_in, min_amount_out) => {
  // deep copy
  const actionsStr = JSON.stringify(actions);
  const newActions = JSON.parse(actionsStr);

  const lastActionIndex = actions.length - 1;
  newActions[0]["amount_in"] = amount_in;
  newActions[lastActionIndex]["min_amount_out"] = min_amount_out;
  return newActions
}

const processAccount = async (a, assets, prices, NearConfig, marginBaseTokenLimitPaged, defaultMarginBaseTokenLimit) => {
  const baseTokenId = a.token_c_info.token_id == a.token_d_info.token_id ? a.token_p_id : a.token_d_info.token_id;
  const baseTokenMarginConfig = marginBaseTokenLimitPaged[baseTokenId] == undefined ? defaultMarginBaseTokenLimit : marginBaseTokenLimitPaged[baseTokenId];
  a.c_asset = assets[a.token_c_info.token_id];
  a.d_asset = assets[a.token_d_info.token_id];
  a.p_asset = assets[a.token_p_id];
  a.c_price = prices?.prices[a.token_c_info.token_id];
  a.d_price = prices?.prices[a.token_d_info.token_id];
  a.p_price = prices?.prices[a.token_p_id];
  a.token_c_price_balance = a.token_c_info.balance
    .mul(a.c_price.multiplier)
    .div(Big(10).pow(a.c_price.decimals + a.c_asset.config.extraDecimals))
  a.token_d_price_balance = a.token_d_info.balance
    .mul(a.d_price.multiplier)
    .div(Big(10).pow(a.d_price.decimals + a.d_asset.config.extraDecimals))
  a.token_p_price_balance = a.token_p_amount
    .mul(a.p_price.multiplier)
    .div(Big(10).pow(a.p_price.decimals + a.p_asset.config.extraDecimals))
  const hp_fee = a.debt_cap.mul(a.d_asset.unitAccHpInterest.sub(a.uahpi_at_open)).div(Big(10).pow(18));
  a.hp_fee_price_balance = hp_fee.gt(Big(0)) ? hp_fee.mul(a.d_price.multiplier)
    .div(Big(10).pow(a.d_price.decimals + a.d_asset.config.extraDecimals)) : Big(0);
  const total_cap = a.token_c_price_balance.add(a.token_p_price_balance);
  const total_debt = a.token_d_price_balance.add(a.hp_fee_price_balance);
  a.is_liquidation = total_cap.gte(total_debt) &&
    total_cap.sub(total_cap.mul(parseRatio(baseTokenMarginConfig.min_safety_buffer))).lt(total_debt)
  a.is_forceclose = total_cap.lt(total_debt)
  a.actions = null;

  if (a.is_liquidation || a.is_forceclose) {
    const tokenPAmountBD = a.token_c_info.token_id == a.token_d_info.token_id ? a.token_p_amount : a.token_p_amount.add(a.token_c_info.balance);
    const tokenPAmountSTDD = tokenPAmountBD.div(Big(10).pow(a.p_asset.config.extraDecimals)).round(0, 0);
    const swapMsg = await getRefExchangeSwapMsg(NearConfig.smartrouterUrl, tokenPAmountSTDD.toFixed(), a.token_p_id, a.token_d_info.token_id, NearConfig.maxSlippage.div(100).toFixed());
    if (swapMsg != "") {
      const tokenDAmountSTDD = getSwapActionsMinAmountOut(JSON.parse(swapMsg).actions, a.token_d_info.token_id);
      const tokenDAmountBD = tokenDAmountSTDD.mul(Big(10).pow(a.d_asset.config.extraDecimals)).round(0, 0);
      const args = {
        pos_owner_id: a.accountId,
        pos_id: a.position,
        token_p_amount: tokenPAmountBD.toFixed(0),
        min_token_d_amount: tokenDAmountBD.toFixed(0),
        swap_indication: {
          dex_id: NearConfig.refFinanceContractId,
          swap_action_text: swapMsg,
        }
      }

      if (a.is_liquidation) {
        const isTokenDAmountBDInvalid = a.token_c_info.token_id == a.token_d_info.token_id ? tokenDAmountBD.add(a.token_c_info.balance).lt(a.token_d_info.balance.add(hp_fee)) : tokenDAmountBD.lt(a.token_d_info.balance.add(hp_fee));
        if (isTokenDAmountBDInvalid) {
          a.is_liquidation = false
        } else {
          if (NearConfig.marginLiquidateDirectMode) {
            a.profit = total_cap.sub(total_debt);
            a.actions = [
              { 
                Borrow: {
                  token_id: a.token_d_info.token_id,
                  amount: a.token_d_info.balance.mul(Big("1.0000001")).toFixed(0), // Add small fraction to avoid rounding errors with shares.
                }
              },
              {
                LiquidateMTPositionDirect: {
                  pos_owner_id: a.accountId,
                  pos_id: a.position,
                }
              }
            ];
          } else {
            a.profit = total_cap.sub(total_debt).mul(Big(baseTokenMarginConfig.liq_benefit_liquidator_rate)).div(Big(10000));
            a.actions = [{ LiquidateMTPosition: args }];
          }
        }
      }

      if (a.is_forceclose) {
        a.loss = total_debt.sub(total_cap);
        a.actions = [{ ForceCloseMTPosition: args }];
      }
    } else {
      liquidateLogger.error("Missing " + a.token_p_id + "&" + a.token_d_info.token_id + " router")
    }
  }
  return a;
}

const margin_execute_with_price_oracle = async (account, NearConfig, actions, isDirectMode=false) => {
  const msg = isDirectMode ? JSON.stringify({
    Execute: {
      actions
    }
  }) : JSON.stringify({
    MarginExecute: {
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

const margin_execute_with_pyth_oracle = async (account, NearConfig, actions, isDirectMode=false) => {
  if (isDirectMode) {
    return await account.functionCall({
      "contractId": NearConfig.burrowContractId,
      "methodName": "execute_with_pyth",
      "args": {
        actions
      },
      "gas": Big(10).pow(12).mul(300).toFixed(0),
      "attachedDeposit": "1",
    });
  } else {
    return await account.functionCall({
      "contractId": NearConfig.burrowContractId,
      "methodName": "margin_execute_with_pyth",
      "args": {
        actions
      },
      "gas": Big(10).pow(12).mul(300).toFixed(0),
      "attachedDeposit": "1",
    });
  }
}

module.exports = {
  main: async (account, burrow_config, NearConfig, burrowContract, assets, prices, marginLiquidate, marginForceClose) => {
    const liquidator = await burrowContract.get_margin_account({ account_id: NearConfig.accountId });
    if (!liquidator) {
      liquidateLogger.error(`${NearConfig.accountId} has not registered ${NearConfig.burrowContractId}`);
      return;
    }
    // const margin_config = await burrowContract.get_margin_config();
    const marginBaseTokenLimitPaged = await account.viewFunction({
      "contractId": NearConfig.burrowContractId,
      "methodName": "get_margin_base_token_limit_paged",
      "args": {}
    });
    const defaultMarginBaseTokenLimit = await account.viewFunction({
      "contractId": NearConfig.burrowContractId,
      "methodName": "get_default_margin_base_token_limit",
      "args": {}
    });
    
    const numAccountsStr = await burrowContract.get_num_margin_accounts();
    const numAccounts = parseInt(numAccountsStr);
    liquidateLogger.debug("Num marginn accounts: ", numAccounts);

    const limit = NearConfig.marginPagedLimit;

    const promises = [];
    for (let i = 0; i < numAccounts; i += limit) {
      promises.push(
        burrowContract.get_margin_accounts_paged({ from_index: i, limit })
      );
    }

    let accounts = (await Promise.all(promises))
      .flat()
      .map((a) => parseAccount(a))
      .flat()
      .filter((a) => !a.is_locking)
    
    accounts = (await Promise.all(accounts.map((account) => 
      processAccount(account, assets, prices, NearConfig, marginBaseTokenLimitPaged, defaultMarginBaseTokenLimit)
    )))
      .filter((a) => (a.is_liquidation && a.actions != null) || (a.is_forceclose && a.actions != null));

    // for (let i = 0; i < accounts.length; ++i) {
    //   accounts[i] = await processAccount(accounts[i], assets, prices, NearConfig, margin_config);
    // }
    // accounts = accounts.filter((a) => (a.is_liquidation && a.actions != null) || (a.is_forceclose && a.actions != null));
      
    // console.log(JSON.stringify(accounts, undefined, 2));


    let liquidationAccounts = [];
    let forcecloseAccounts = [];

    for (let i = 0; i < accounts.length; ++i) {
      if (accounts[i].is_liquidation) {
        liquidationAccounts.push(accounts[i]);
      }
      if (accounts[i].is_forceclose) {
        forcecloseAccounts.push(accounts[i]);
      }
    }

    liquidationAccounts.sort((a, b) => {
      return b.profit.cmp(a.profit);
    })
    forcecloseAccounts.sort((a, b) => {
      return b.loss.cmp(a.loss);
    })

    if (marginLiquidate && liquidationAccounts.length > 0) {
      try {
        if (liquidationAccounts[0].profit.gte(NearConfig.minProfit)) {
          liquidateLogger.debug("liquidation action:");
          liquidateLogger.debug(JSON.stringify(liquidationAccounts[0].actions, undefined, 2));
          const outcome = burrow_config.enable_price_oracle ?
            await margin_execute_with_price_oracle(account, NearConfig, liquidationAccounts[0].actions, NearConfig.marginLiquidateDirectMode) :
            await margin_execute_with_pyth_oracle(account, NearConfig, liquidationAccounts[0].actions, NearConfig.marginLiquidateDirectMode);
          printOutcome("margin liquidation", "./logs/margin_liquidation_success.log", outcome)
        }
      }
      catch (Error) {
        liquidateLogger.error("Error: ", Error)
      }
    }

    if (marginForceClose && forcecloseAccounts.length > 0) {
      try {
        if (forcecloseAccounts[0].loss.gte(NearConfig.marginForceCloseMinLoss)) {
          liquidateLogger.debug("forceclose action:");
          liquidateLogger.debug(JSON.stringify(forcecloseAccounts[0].actions, undefined, 2));
          const outcome = burrow_config.enable_price_oracle ?
            await margin_execute_with_price_oracle(account, NearConfig, forcecloseAccounts[0].actions) :
            await margin_execute_with_pyth_oracle(account, NearConfig, forcecloseAccounts[0].actions);
          printOutcome("margin force_close", "./logs/margin_force_close_success.log", outcome)
        }
      }
      catch (Error) {
        liquidateLogger.error("Error: ", Error)
      }
    }

    {
      const withdrawActions = [];
      for (let i = 0; i < liquidator.supplied.length; ++i) {
        const s = liquidator.supplied[i];
        const asset = assets[s.token_id];
        const price = prices?.prices[s.token_id];
        const pricedBalance = Big(s.balance)
          .mul(price.multiplier)
          .div(Big(10).pow(price.decimals + asset.config.extraDecimals))
        if (pricedBalance.gt(NearConfig.minSwapAmount)) {
          liquidateLogger.debug(`Withdrawing ${s.token_id} amount ${s.balance}`);
          withdrawActions.push({
            Withdraw: {
              token_id: s.token_id,
            },
          });
        }
      }

      if (withdrawActions.length > 0) {
        liquidateLogger.debug(JSON.stringify(withdrawActions, undefined, 2))
        await account.functionCall({
          "contractId": NearConfig.burrowContractId,
          "methodName": "margin_execute",
          "args": {
            "actions": withdrawActions,
          },
          "gas": Big(10).pow(12).mul(300).toFixed(0),
          "attachedDeposit": "1",
        })
      }
    }
  }
}