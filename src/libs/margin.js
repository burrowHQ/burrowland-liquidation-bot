const Big = require("big.js");
const { parseRatio } = require("./utils");

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
    total_cap.sub(total_cap.mul(parseRatio(margin_config.min_safty_buffer))).lt(total_debt)
  a.is_forceclose = total_cap.lt(total_debt)
  a.actions = null;

  if (a.is_liquidation || a.is_forceclose) {
    const routerId = a.token_p_id + "&" + a.token_d_info.token_id;
    const token_p_amount_arg = a.token_c_info.token_id == a.token_d_info.token_id ? a.token_p_amount : a.token_p_amount.add(a.token_c_info.balance);
    const min_token_d_amount_arg = a.token_c_info.token_id == a.token_d_info.token_id ? 
      a.token_p_price_balance.mul(Big(10).pow(a.d_price.decimals + a.d_asset.config.extraDecimals)).mul(Big(0.95)).div(a.d_price.multiplier).round(0, 0) :
      a.token_p_price_balance.add(a.token_c_price_balance).mul(Big(10).pow(a.d_price.decimals + a.d_asset.config.extraDecimals)).mul(Big(0.95)).div(a.d_price.multiplier).round(0, 0);
    if (NearConfig.router[routerId]) {
      const args = {
        pos_owner_id: a.accountId,
        pos_id: a.position,
        token_p_amount: token_p_amount_arg.toFixed(0),
        min_token_d_amount: min_token_d_amount_arg.toFixed(0),
        swap_indication: {
          dex_id: NearConfig.router[routerId].dex_id,
          swap_action_text: NearConfig.router[routerId].dex_type == 1 ? JSON.stringify({
            actions: [{
              pool_id: NearConfig.router[routerId].pool_id,
              token_in: a.token_p_id,
              amount_in: token_p_amount_arg.div(Big(10).pow(a.p_asset.config.extraDecimals)).round(0, 0).toFixed(0),
              token_out: a.token_d_info.token_id,
              min_amount_out: min_token_d_amount_arg.div(Big(10).pow(a.d_asset.config.extraDecimals)).round(0, 0).toFixed(0),
            }]
          }) :
          JSON.stringify({
            Swap: {
              pool_ids: NearConfig.router[routerId].pool_ids,
              output_token: a.token_d_info.token_id,
              min_output_amount: min_token_d_amount_arg.div(Big(10).pow(a.d_asset.config.extraDecimals)).round(0, 0).toFixed(0),
              skip_unwrap_near: true,
            }
          })
        }
      }

      if (a.is_liquidation) {
        if (min_token_d_amount_arg.lte(a.token_d_info.balance.add(hp_fee))) {
          a.is_liquidation = false
        } else {
          a.profit = total_cap.sub(total_debt);
          a.actions = [{LiquidateMTPosition: args}];
        }
      }

      if (a.is_forceclose) {
        a.lose = total_debt.sub(total_cap);
        a.actions = [{ForceCloseMTPosition: args}];
      }
    } else {
      console.log("Missing " + routerId + " router")
    }
  }
  return a;
}

const printOutcome = (filePath, outcome) => {
  let failureMessages = []
  let is_success = Object.values(outcome['receipts_outcome']).reduce((is_success, receipt) => {
    if (receipt["outcome"]["status"].hasOwnProperty("Failure")) {
      failureMessages.push(receipt["outcome"]["status"])
      return false;
    }
    return is_success;
  }, true);
  if (is_success) {
    logToFile(filePath, new Date() + " success tx: " + outcome["transaction"]["hash"]);
    console.log("");
    console.log("success tx: ", outcome["transaction"]["hash"]);
    console.log("");
  } else {
    console.log("");
    console.log("failed: ");
    console.log(JSON.stringify(failureMessages, undefined, 2));
    console.log("");
  }
}

const margin_execute_with_price_oracle = async (account, NearConfig, actions) => {
  const msg = JSON.stringify({
    MarginExecute: {
      actions
    }
  });
  return await account.functionCall(
    NearConfig.priceOracleContractId,
    "oracle_call",
    {
      receiver_id: NearConfig.burrowContractId,
      msg,
    },
    Big(10).pow(12).mul(300).toFixed(0),
    "1",
  );
}

const margin_execute_with_pyth_oracle = async (account, NearConfig, actions) => {
  return await account.functionCall(
    NearConfig.burrowContractId,
    "margin_execute_with_pyth",
    {
      actions
    },
    Big(10).pow(12).mul(300).toFixed(0),
    "1",
  );
    
}

module.exports = {
  main: async (account, burrow_config, NearConfig, burrowContract, assets, prices) => {
    const margin_config = await burrowContract.get_margin_config();
    const numAccountsStr = await burrowContract.get_num_margin_accounts();
    const numAccounts = parseInt(numAccountsStr);
    console.log("Num marginn accounts: ", numAccounts);

    const limit = 40;

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
        .filter((a) => (a.is_liquidation && a.actions != null) || (a.is_forceclose && a.actions != null));

    // console.log(JSON.stringify(accounts, undefined, 2));
    

    let liquidationAccounts = [];
    let forcecloseAccounts = [];

    for (let i = 0; i < accounts.length; ++i) {
      if (accounts[i].is_liquidation){
        liquidationAccounts.push(accounts[i]);
      }
      if (accounts[i].is_forceclose){
        forcecloseAccounts.push(accounts[i]);
      }
    }

    liquidationAccounts.sort((a, b) => {
      return b.profit.cmp(a.profit);
    })
    forcecloseAccounts.sort((a, b) => {
      return b.lose.cmp(a.lose);
    })
    
    if (liquidationAccounts.length > 0) {
      try {
        if (liquidationAccounts[0].profit.gte(NearConfig.minProfit)) {
          console.log("liquidation action:");
          console.log(JSON.stringify(liquidationAccounts[0].actions, undefined, 2));
          const outcome = burrow_config.enable_price_oracle ? 
            await margin_execute_with_price_oracle(account, NearConfig, liquidationAccounts[0].actions) :
            await margin_execute_with_pyth_oracle(account, NearConfig, liquidationAccounts[0].actions);
          printOutcome("./logs/margin_liquidation_success.log", outcome)
        }
      }
      catch (Error) {
         console.log("Error: ",Error)
      }
    }

    if (forcecloseAccounts.length > 0) {
      try {
        console.log("forceclose action:");
        console.log(JSON.stringify(forcecloseAccounts[0].actions, undefined, 2));
        const outcome = burrow_config.enable_price_oracle ? 
          await margin_execute_with_price_oracle(account, NearConfig, forcecloseAccounts[0].actions) :
          await margin_execute_with_pyth_oracle(account, NearConfig, forcecloseAccounts[0].actions);
        printOutcome("./logs/margin_force_close_success.log", outcome)
      }
      catch (Error) {
         console.log("Error: ",Error)
      }
    }

    {
      const liquidator = await burrowContract.get_margin_account({account_id: NearConfig.accountId});

      const withdrawActions = [];
      for (let i = 0; i < liquidator.supplied.length; ++i) {
        const s = liquidator.supplied[i];
        const asset = assets[s.token_id];
        const price = prices?.prices[s.token_id];
        const pricedBalance = Big(s.balance)
          .mul(price.multiplier)
          .div(Big(10).pow(price.decimals + asset.config.extraDecimals))
        if (pricedBalance.gt(NearConfig.minSwapAmount)) {
          console.log(`Withdrawing ${s.token_id} amount ${s.balance}`);
          withdrawActions.push({
            Withdraw: {
              token_id: s.token_id,
            },
          });
        }
      }
      console.log(JSON.stringify(withdrawActions, undefined, 2))
    
      if (withdrawActions.length > 0) {
        await burrowContract.margin_execute(
          {
            actions: withdrawActions,
          },
          Big(10).pow(12).mul(300).toFixed(0),
          "1"
        );
      }
    }
  }
}