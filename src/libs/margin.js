const Big = require("big.js");
const { parseRatio, printOutcome } = require("./utils");
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

const processAccount = (a, assets, prices, NearConfig, margin_config) => {
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
    total_cap.sub(total_cap.mul(parseRatio(margin_config.min_safety_buffer))).lt(total_debt)
  a.is_forceclose = total_cap.lt(total_debt)
  a.actions = null;

  if (a.is_liquidation || a.is_forceclose) {
    const routerId = a.token_p_id + "&" + a.token_d_info.token_id;
    const token_p_amount_arg = a.token_c_info.token_id == a.token_d_info.token_id ? a.token_p_amount : a.token_p_amount.add(a.token_c_info.balance);
    const min_token_d_amount_arg = a.token_c_info.token_id == a.token_d_info.token_id ?
      a.token_p_price_balance.mul(Big(10).pow(a.d_price.decimals + a.d_asset.config.extraDecimals)).mul(Big(0.99)).div(a.d_price.multiplier).round(0, 0) :
      a.token_p_price_balance.add(a.token_c_price_balance).mul(Big(10).pow(a.d_price.decimals + a.d_asset.config.extraDecimals)).mul(Big(0.99)).div(a.d_price.multiplier).round(0, 0);
    if (NearConfig.marginRouter[routerId]) {
      const args = {
        pos_owner_id: a.accountId,
        pos_id: a.position,
        token_p_amount: token_p_amount_arg.toFixed(0),
        min_token_d_amount: min_token_d_amount_arg.toFixed(0),
        swap_indication: {
          dex_id: NearConfig.marginRouter[routerId].dex_id,
          swap_action_text: NearConfig.marginRouter[routerId].dex_type == 1 ? JSON.stringify({
            actions: updateActions(
              NearConfig.marginRouter[routerId].actions,
              token_p_amount_arg.div(Big(10).pow(a.p_asset.config.extraDecimals)).round(0, 0).toFixed(0),
              min_token_d_amount_arg.div(Big(10).pow(a.d_asset.config.extraDecimals)).round(0, 0).toFixed(0)
            )
          }) :
            JSON.stringify({
              Swap: {
                pool_ids: NearConfig.marginRouter[routerId].pool_ids,
                output_token: a.token_d_info.token_id,
                min_output_amount: min_token_d_amount_arg.div(Big(10).pow(a.d_asset.config.extraDecimals)).round(0, 0).toFixed(0),
                skip_unwrap_near: true,
              }
            })
        }
      }

      if (a.is_liquidation) {
        const is_min_token_d_amount_valid = a.token_c_info.token_id == a.token_d_info.token_id ? min_token_d_amount_arg.add(a.token_c_info.balance).lt(a.token_d_info.balance.add(hp_fee)) : min_token_d_amount_arg.lt(a.token_d_info.balance.add(hp_fee));
        if (is_min_token_d_amount_valid) {
          a.is_liquidation = false
        } else {
          a.profit = total_cap.sub(total_debt).mul(Big(margin_config.liq_benefit_liquidator_rate)).div(Big(10000));
          a.actions = [{ LiquidateMTPosition: args }];
        }
      }

      if (a.is_forceclose) {
        a.lose = total_debt.sub(total_cap);
        a.actions = [{ ForceCloseMTPosition: args }];
      }
    } else {
      liquidateLogger.error("Missing " + routerId + " router")
    }
  }
  return a;
}

const margin_execute_with_price_oracle = async (account, NearConfig, actions) => {
  const msg = JSON.stringify({
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

const margin_execute_with_pyth_oracle = async (account, NearConfig, actions) => {
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

module.exports = {
  main: async (account, burrow_config, NearConfig, burrowContract, assets, prices, marginLiquidate, marginForceClose) => {
    const liquidator = await burrowContract.get_margin_account({ account_id: NearConfig.accountId });
    if (!liquidator) {
      liquidateLogger.error(`${NearConfig.accountId} has not registered ${NearConfig.burrowContractId}`);
      return;
    }
    const margin_config = await burrowContract.get_margin_config();
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

    const accounts = (await Promise.all(promises))
      .flat()
      .map((a) => parseAccount(a))
      .flat()
      .filter((a) => !a.is_locking)
      .map((a) => processAccount(a, assets, prices, NearConfig, margin_config))
      .filter((a) => (a.is_liquidation && a.actions != null) || (a.is_forceclose && a.actions != null))

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
      return b.lose.cmp(a.lose);
    })

    if (marginLiquidate && liquidationAccounts.length > 0) {
      try {
        if (liquidationAccounts[0].profit.gte(NearConfig.minProfit)) {
          liquidateLogger.debug("liquidation action:");
          liquidateLogger.debug(JSON.stringify(liquidationAccounts[0].actions, undefined, 2));
          const outcome = burrow_config.enable_price_oracle ?
            await margin_execute_with_price_oracle(account, NearConfig, liquidationAccounts[0].actions) :
            await margin_execute_with_pyth_oracle(account, NearConfig, liquidationAccounts[0].actions);
          printOutcome("margin liquidation", "./logs/margin_liquidation_success.log", outcome)
        }
      }
      catch (Error) {
        liquidateLogger.error("Error: ", Error)
      }
    }

    if (marginForceClose && forcecloseAccounts.length > 0) {
      try {
        liquidateLogger.debug("forceclose action:");
        liquidateLogger.debug(JSON.stringify(forcecloseAccounts[0].actions, undefined, 2));
        const outcome = burrow_config.enable_price_oracle ?
          await margin_execute_with_price_oracle(account, NearConfig, forcecloseAccounts[0].actions) :
          await margin_execute_with_pyth_oracle(account, NearConfig, forcecloseAccounts[0].actions);
        printOutcome("margin force_close", "./logs/margin_force_close_success.log", outcome)
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