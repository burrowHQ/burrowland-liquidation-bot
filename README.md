# How to obtain the ciphertext of a private key

1. Replace the strings `YOUR_PASSWORD` and `YOUR_PRIVATE_KEY` in the `./tools/aes.js` code with the corresponding content.
2. Run `node ./tools/aes.js`, and you will see output similar to the following:
```
Plaintext: YOUR_PRIVATE_KEY
Ciphertext: U2FsdGVkX1/7aneCmglnC87f76OweiOdEWrjGdPvrM1qSvAWEHavo4mf2ZesW6f0
Decrypted text: YOUR_PRIVATE_KEY
```
- The content of the `Ciphertext` in the output is used to assign a value to the `ENCODE_PRIVATE_KEY` environment variable when running the container.
- The content replacing `YOUR_PASSWORD` in the code needs to be input when starting the container.

# How to run 
```shell
docker pull refburrow/burrowland-liquidation-bot:latest
```
```shell
docker run -e NEAR_ACCOUNT_ID=${SIGNER_NEAR_ACCOUNT_ID} -e ENCODE_PRIVATE_KEY=${SIGNER_ENCODE_PRIVATE_KEY} -it refburrow/burrowland-liquidation-bot
```
When you see the command prompt `Please enter your password:`, please input `YOUR_PASSWORD` and press Enter.

After seeing normal program logs, you can first press Ctrl + P, then press Ctrl + Q to allow the container to continue running in the background.

## Required Environment Variables

`YOUR_NEAR_ACCOUNT_ID`: near account id for signing

`ENCODE_PRIVATE_KEY`: encrypted private key for the near account id used for signing

## Optional Environment Variables

`NODE_URL`: NEAR RPC API url

`MIN_PROFIT`: minimum profit value for liquidation, default: 1(U)

`MIN_DISCOUNT`: minimum discount required for liquidation target account, default: 0.025
- hf = adjustedCollateralValue / adjustedBorrowedValue
- discount = 0.5 * (1 - hf)

`MAX_LIQUIDATION_AMOUNT`: maximum value repaid in a single liquidation, signer must have sufficient collateral, default: 20000(U)

`LOOP_INTERVAL`: The time interval for executing liquidations in a loop, default: 5(s)