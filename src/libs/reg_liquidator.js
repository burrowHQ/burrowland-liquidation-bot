const Big = require("big.js");
const log4js = require('log4js');
const registerLogger = log4js.getLogger();

Big.DP = 27;

async function main(nearObjects, tokenRegisterAlreadyCheckList=[]) {
    registerLogger.info('Register Begin');
    const { account, tokenContract, burrowContract, txSender, NearConfig } = nearObjects;

    // try to read liquidator account from burrowland
    const burrowAccount = await burrowContract.get_account({ account_id: process.env.TARGET_NEAR_ACCOUNT_ID ? process.env.TARGET_NEAR_ACCOUNT_ID : account.accountId })
    if (burrowAccount == null) {
        registerLogger.info(`Paying storage for burrowContract`);
        await txSender.sendFunctionCall({
            "contractId": NearConfig.burrowContractId,
            "methodName": "storage_deposit",
            "args": {
                account_id: process.env.TARGET_NEAR_ACCOUNT_ID ? process.env.TARGET_NEAR_ACCOUNT_ID : account.accountId,
                registration_only: true,
            },
            "gas": Big(10).pow(12).mul(300).toFixed(0),
            "attachedDeposit": Big(10).pow(23).toFixed(0),
        });
    }
    else {
        registerLogger.debug('burrowAccount', JSON.stringify(burrowAccount, null, 2));
    }

    const refFinanceAccount = await account.viewFunction({
        "contractId": NearConfig.refFinanceContractId,
        "methodName": "get_account_basic_info",
        "args": {
            "account_id": process.env.TARGET_NEAR_ACCOUNT_ID ? process.env.TARGET_NEAR_ACCOUNT_ID : account.accountId,
        }
    });
    if (refFinanceAccount == null) {
        registerLogger.info(`Paying storage for refFinanceContract`);
        // account in ref exchange
        await txSender.sendFunctionCall({
            "contractId": NearConfig.refFinanceContractId,
            "methodName": "storage_deposit",
            "args": {
                account_id: process.env.TARGET_NEAR_ACCOUNT_ID ? process.env.TARGET_NEAR_ACCOUNT_ID : account.accountId,
                registration_only: true,
            },
            "gas": Big(10).pow(12).mul(300).toFixed(0),
            "attachedDeposit": Big(10).pow(23).toFixed(0),
        });
    } else {
        registerLogger.debug('refFinanceAccount', JSON.stringify(refFinanceAccount, null, 2));
    }


    // account in misc tokens
    // read assets
    const rawAssets = await burrowContract.get_assets_paged();
    for (let i = 0; i < rawAssets.length; ++i) {
        const tokenId = rawAssets[i][0]
        if (tokenId.substring(0, 14) != "shadow_ref_v1-" && (rawAssets[i][1]['config']['can_use_as_collateral'] == true || rawAssets[i][1]['config']['can_borrow'] == true) && !tokenRegisterAlreadyCheckList.includes(tokenId)) {
            registerLogger.debug('check', tokenId)
            const token = tokenContract(tokenId);
            const storageBalance = await token.storage_balance_of({
                account_id: process.env.TARGET_NEAR_ACCOUNT_ID ? process.env.TARGET_NEAR_ACCOUNT_ID : account.accountId,
            });
            if (Big(storageBalance?.total || 0).eq(0)) {
                registerLogger.info(`Paying storage for ${tokenId}\n`);
                await txSender.sendFunctionCall({
                    "contractId": tokenId,
                    "methodName": "storage_deposit",
                    "args": {
                        account_id: process.env.TARGET_NEAR_ACCOUNT_ID ? process.env.TARGET_NEAR_ACCOUNT_ID : account.accountId,
                        registration_only: true,
                    },
                    "gas": Big(10).pow(12).mul(300).toFixed(0),
                    "attachedDeposit": Big(10).pow(23).toFixed(0),
                });
            }
            tokenRegisterAlreadyCheckList.push(tokenId);
        } else {
            registerLogger.debug('skip', tokenId)
        }
    }

}

module.exports = {
    main
}