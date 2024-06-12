const Big = require("big.js");

module.exports = {
  main: async (nearObjects) => {
      console.log(new Date(), "Token register check started")
      const { tokenContract, burrowContract, NearConfig } = nearObjects;
      const rawAssets = await burrowContract.get_assets_paged();
      const assetIds = rawAssets.reduce((assetIds, [assetId]) => {
        assetIds.push(assetId);
        return assetIds;
      }, []);

      for (let i = 0; i < assetIds.length; ++i) {
        const tokenId = assetIds[i];
        if (tokenId.substring(0, 14) == "shadow_ref_v1-") {
          continue;
        }
        const token = tokenContract(tokenId);
        const storageBalance = await token.storage_balance_of({
          account_id: NearConfig.accountId,
        });
        if (Big(storageBalance?.total || 0).eq(0)) {
          console.log(`Register storage for ${tokenId}`);
          await token.storage_deposit(
            { registration_only: true },
            Big(10).pow(12).mul(300).toFixed(0),
            Big(10).pow(23).toFixed(0)
          );
        }
      }
      console.log(new Date(), "Token register check completed")
    }
}