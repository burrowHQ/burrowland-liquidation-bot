// used to register liquidator account to misc contracts
const Big = require("big.js");
const { initNear } = require("./libs/near");

const { parseAsset } = require("./libs/asset");
const { parseAccountDetailed, processAccount } = require("./libs/account");


Big.DP = 27;

async function main(nearObjects) {
  const { tokenContract, refFinanceContract, burrowContract, priceOracleContract, NearConfig } = nearObjects;


  // try to read liquidator account from burrowland
  const burrowAccount = await burrowContract.get_account({account_id: NearConfig.accountId  })
  if(burrowAccount == null){
      console.log(`Paying storage for burrowContract`);
      await burrowContract.storage_deposit({
          account_id: NearConfig.accountId,
          registration_only: true,
        },
        Big(10).pow(12).mul(300).toFixed(0),
        Big(10).pow(24).toFixed(0)
      )
  }
  else {
    console.log(JSON.stringify(burrowAccount, null, 2));
  }

  // account in ref exchange
  await refFinanceContract.storage_deposit({
      account_id: NearConfig.accountId,
      registration_only: true,
    },
    Big(10).pow(12).mul(300).toFixed(0),
    Big(10).pow(23).toFixed(0)
  )

  // account in misc tokens
  // read assets
  const rawAssets = await burrowContract.get_assets_paged();
  for (let i = 0; i < rawAssets.length; ++i){
    token_id = rawAssets[i][0] 
    console.log(token_id)
    const token = tokenContract(token_id);
    const storageBalance = await token.storage_balance_of({
      account_id: NearConfig.accountId,
    });
    if (Big(storageBalance?.total || 0).eq(0)) {
      console.log(`Paying storage for ${token_id}\n`);

      await token.storage_deposit(
        { registration_only: true },
        Big(10).pow(12).mul(300).toFixed(0),
        Big(10).pow(23).toFixed(0)
      );
    }
  }

}

initNear(true, process.env.KEY_PATH || null).then((nearObject) =>
  main(nearObject)
);

