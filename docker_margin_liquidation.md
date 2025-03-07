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

## Create a env file.

Create your own env file based on liquidator.env.example.

`NEAR_ACCOUNT_ID`: near account id for signing.

`ENCODE_PRIVATE_KEY`: encrypted private key for the near account id used for signing.

`NODE_URL`: NEAR RPC API url, default: https://rpc.mainnet.near.org

## Run Command

Get the docker image.
```shell
docker pull refburrow/burrowland-margin-liquidation-bot:v1.0.0
```

Then, run the container:

```shell
docker run --env-file ${YOUR_ENV_FILE_PATH} -it refburrow/burrowland-margin-liquidation-bot:v1.0.0
```

When you see the command prompt `Please enter your password:`, please input `YOUR_PASSWORD` and press Enter.

When you see `Liquidation check completed` in the output logs, it means that the program has run successfully, you can first press Ctrl + P, then press Ctrl + Q to allow the container to continue running in the background.

The normal log output is as follows:
```
[2025-03-07T09:54:23.683] [INFO] default - Register Begin
[2025-03-07T09:54:23.686] [INFO] default - Liquidate Begin
[2025-03-07T09:54:23.687] [INFO] default - Rebalance Begin
[2025-03-07T09:54:23.683] [INFO] default - Register End
[2025-03-07T09:54:23.686] [INFO] default - Liquidate End
[2025-03-07T09:54:23.687] [INFO] default - Rebalance End
```

When you see a log starting with `success tx:`, it indicates that a liquidation has been successfully executed. You can copy the transaction hash from the log and query for details on the NEAR Explorer.