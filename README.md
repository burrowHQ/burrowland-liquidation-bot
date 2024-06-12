# How to obtain the ciphertext of a private key

1. Run `npm install` to install dependencies.
2. Replace the strings `YOUR_PASSWORD` and `YOUR_PRIVATE_KEY(ed25519:xxxxx)` in the `./tools/aes.js` code with the corresponding content.
3. Run `node ./tools/aes.js`, and you will see output similar to the following:
```
Plaintext: YOUR_PRIVATE_KEY
Ciphertext: U2FsdGVkX1/7aneCmglnC87f76OweiOdEWrjGdPvrM1qSvAWEHavo4mf2ZesW6f0
Decrypted text: YOUR_PRIVATE_KEY
```
- The Ciphertext field in the output is used to modify the `encodePrivateKey` item in the configuration file.
- The content replacing `YOUR_PASSWORD` in the code needs to be input when starting the container.

# How to run 

## Create a configuration file.

Create the JSON configuration file as follows:
```
{
    "accountId": "SIGNER_NEAR_ACCOUNT_ID",
    "encodePrivateKey": "SIGNER_ENCODE_PRIVATE_KEY",
    "nodeUrl": "https://rpc.mainnet.near.org",
    "minProfit": "1.0",
    "minDiscount": "0.05",
    "minRepayAmount": "0.5",
    "minSwapAmount": "1",
    "loopInterval": "30000"
}
```

The meanings of all configuration items are as follows:

`accountId`: near account id for signing

`encodePrivateKey`: encrypted private key for the near account id used for signing

`nodeUrl`: NEAR RPC API url, default: https://rpc.mainnet.near.org

`minProfit`: minimum profit value for liquidation, default: 1.0(U)

`minDiscount`: minimum discount required for liquidation target account, default: 0.05
- hf = adjustedCollateralValue / adjustedBorrowedValue
- discount = 0.5 * (1 - hf)

`minRepayAmount`: When the debt value exceeds the minRepayAmount and the user has this token in their wallet, it will automatically perform the repay operation for the user, default: 0.5(U)

`minSwapAmount`: default: 1(U).Control three scenarios:
- When the user has assets in the supplied section of the burrow contract and the value is greater than minSwapAmount, it will automatically perform a withdraw action to transfer the assets to the user's wallet.
- When the user holds non-wrap.near assets supported by the burrow contract in their wallet and the value exceeds minSwapAmount, it will automatically swap them to wrap.near.
- When the user's debt value in the burrow contract exceeds minSwapAmount, it will automatically use the wrap.near in the user's wallet to purchase the debt assets and perform the repay operation. Since interest is still generated during this process, a small amount of debt will still remain after the repay operation.

`loopInterval`: The time interval for executing liquidations in a loop, default: 30000(ms)

## Run Command

Get the docker image.
```shell
docker pull refburrow/burrowland-liquidation-bot:v1.1.0
```

Then, run the container:

```shell
docker run -v ${YOUR_CONFIG_JSON_FILE_PATH}:/app/config.json -it refburrow/burrowland-liquidation-bot:v1.1.0
```

When you see the command prompt `Please enter your password:`, please input `YOUR_PASSWORD` and press Enter.

When you see `Liquidation check completed` in the output logs, it means that the program has run successfully, you can first press Ctrl + P, then press Ctrl + Q to allow the container to continue running in the background.

The normal log output is as follows:
```
2024-05-10T07:09:41.141Z liquidation check started
Accounts with health less than 100 and discount greater than or equal to 0.05: [
  'user1.near REGULAR-> healthFactor: 87.73% -> discount: 6.13% -> borrowedSum: $0.6850816590893518166868',
  'user2.near REGULAR-> healthFactor: 88.37% -> discount: 5.82% -> borrowedSum: $3.58862871088193509655039233'
]
Maybe liq user1.near -> position REGULAR -> discount 6.13% -> profit $0.022782841070313249014012405
Maybe liq user2.near -> position REGULAR -> discount 5.82% -> profit $0.105884178804873633297812221
2024-05-10T07:09:41.963Z Liquidation check completed

2024-05-10T07:09:41.141Z Rebalance check started
2024-05-10T07:09:41.963Z Rebalance check completed

2024-05-10T07:09:41.141Z Token register check started
2024-05-10T07:09:41.963Z Token register check completed
```

When you see a log starting with `success tx:`, it indicates that a liquidation has been successfully executed. You can copy the transaction hash from the log and query for details on the NEAR Explorer.