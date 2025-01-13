// used to register liquidator account to misc contracts
const Big = require("big.js");
const { initNear } = require("./libs/near");

Big.DP = 27;

async function main(nearObjects) {
  const { account, tokenContract, burrowContract, NearConfig } = nearObjects;


  // try to read liquidator account from burrowland
  const burrowAccount = await burrowContract.get_account({ account_id: NearConfig.accountId })
  if (burrowAccount == null) {
    console.log(`Paying storage for burrowContract`);
    await account.functionCall({
      "contractId": NearConfig.burrowContractId,
      "methodName": "storage_deposit",
      "args": {
        account_id: NearConfig.accountId,
        registration_only: true,
      },
      "gas": Big(10).pow(12).mul(300).toFixed(0),
      "attachedDeposit": Big(10).pow(23).toFixed(0),
    });
  }
  else {
    console.log('burrowAccount', JSON.stringify(burrowAccount, null, 2));
  }

  const refFinanceAccount = await account.viewFunction({
    "contractId": NearConfig.refFinanceContractId,
    "methodName": "get_account_basic_info",
    "args": {
      "account_id": NearConfig.accountId,
    }
  });
  if (refFinanceAccount == null) {
    console.log(`Paying storage for refFinanceContract`);
    // account in ref exchange
    await account.functionCall({
      "contractId": NearConfig.refFinanceContractId,
      "methodName": "storage_deposit",
      "args": {
        account_id: NearConfig.accountId,
        registration_only: true,
      },
      "gas": Big(10).pow(12).mul(300).toFixed(0),
      "attachedDeposit": Big(10).pow(23).toFixed(0),
    });
  } else {
    console.log('refFinanceAccount', JSON.stringify(refFinanceAccount, null, 2));
  }


  // account in misc tokens
  // read assets
  const rawAssets = await burrowContract.get_assets_paged();
  for (let i = 0; i < rawAssets.length; ++i) {
    const tokenId = rawAssets[i][0]
    console.log('check', tokenId)
    if (tokenId.substring(0, 14) != "shadow_ref_v1-") {
      const token = tokenContract(tokenId);
      const storageBalance = await token.storage_balance_of({
        account_id: NearConfig.accountId,
      });
      if (Big(storageBalance?.total || 0).eq(0)) {
        console.log(`Paying storage for ${tokenId}\n`);
        await account.functionCall({
          "contractId": tokenId,
          "methodName": "storage_deposit",
          "args": {
            registration_only: true,
          },
          "gas": Big(10).pow(12).mul(300).toFixed(0),
          "attachedDeposit": Big(10).pow(23).toFixed(0),
        });
      }
    }
  }

}

initNear(true, process.env.KEY_PATH || null).then((nearObject) =>
  main(nearObject)
);

