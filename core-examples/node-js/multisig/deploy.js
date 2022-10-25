const { TonClient } = require("@eversdk/core");
const { libNode } = require("@eversdk/lib-node");
const { SafeMultisigContract, getPreparedSigner } = require("./utils");

TonClient.useBinaryLibrary(libNode);

// Create a project on https://dashboard.evercloud.dev and pass
// its Development Network HTTPS endpoint as a parameter:
const HTTPS_DEVNET_ENDPOINT = process.argv[2] 

if (HTTPS_DEVNET_ENDPOINT === undefined) {
    throw new Error("HTTPS endpoint required")
}

// Account is active when contract is deployed.
const ACCOUNT_TYPE_ACTIVE = 1;

// Account is uninitialized when contract is not deployed yet.
const ACCOUNT_TYPE_UNINITIALIZED = 0;

// Number of tokens required to deploy the contract.
// See https://docs.everos.dev/ever-sdk/guides/work_with_contracts/estimate_fees on how to calculate definite number.
const CONTRACT_REQUIRED_DEPLOY_TOKENS = 500_000_000;

(async () => {
    try {
        //Read more about NetworkConfig https://docs.everos.dev/ever-sdk/guides/installation/configure_sdk
        const tonClient = new TonClient({
            network: {
                endpoints: [ HTTPS_DEVNET_ENDPOINT ],
            },
        });

        const signer = getPreparedSigner();

        // We create a deploy message to calculate the future address of the contract
        // and to send it with 'sendMessage' later - if we use Pattern 1 for deploy (see below)
        const { address } = await tonClient.abi.encode_message({
            abi: SafeMultisigContract.abi,
            deploy_set: {
                tvc: SafeMultisigContract.tvc,
                initial_data: {},
            },
            call_set: {
                function_name: "constructor",
                input: {
                    // Multisig owners public key.
                    // We are going to use a single key.
                    // You can use any number of keys and custodians.
                    // See https://github.com/tonlabs/ton-labs-contracts/tree/master/solidity/safemultisig#35-deploy-wallet-set-custodians
                    owners: [`0x${signer.keys.public}`],
                    // Number of custodians to require for confirm transaction.
                    // We use 0 for simplicity. Consider using 2+ for sufficient security.
                    reqConfirms: 0,
                },
            },
            signer,
            processing_try_index: 1,
        });

        // Query account type, balance and code to analyse if it is possible to deploy the contract
        // See more info about query method here https://github.com/tonlabs/ever-sdk/blob/master/docs/reference/types-and-methods/mod_net.md#query_collection
        /** @type {{ acc_type: number, balance: string, code: string}[]} */
        const result = (await tonClient.net.query_collection({
            collection: "accounts",
            filter: {
                id: {
                    eq: address,
                },
            },
            result: "acc_type balance code",
        })).result;
        if (result.length === 0) {
            console.log(`You need to transfer at least 0.5 tokens for deploy to ${address} to DevNet.`);
            process.exit(1);
        }

        if (result[0].acc_type === ACCOUNT_TYPE_ACTIVE) {
            console.log(`Contract ${address} is already deployed`);
            process.exit(1);
        }

        // Balance is stored as HEX so we need to convert it.
        if (result[0].acc_type === ACCOUNT_TYPE_UNINITIALIZED && BigInt(result[0].balance) <= BigInt(
            CONTRACT_REQUIRED_DEPLOY_TOKENS)) {
            console.log(`Balance of ${address} is too low for deploy to DevNet`);
            process.exit(1);
        }

        const response = await tonClient.processing.process_message({
            send_events: false,
            message_encode_params: {
                abi: SafeMultisigContract.abi,
                deploy_set: {
                    tvc: SafeMultisigContract.tvc,
                    initial_data: {},
                },
                call_set: {
                    function_name: "constructor",
                    input: {
                        // Multisig owners public key.
                        // We are going to use a single key.
                        // You can use any number of keys and custodians.
                        // See https://github.com/tonlabs/ton-labs-contracts/tree/master/solidity/safemultisig#35-deploy-wallet-set-custodians
                        owners: [`0x${signer.keys.public}`],
                        // Number of custodians to require for confirm transaction.
                        // We use 0 for simplicity. Consider using 2+ for sufficient security.
                        reqConfirms: 0,
                    },
                },
                signer,
                processing_try_index: 1,
            },
        });
        console.log(`Transaction id is ${response.transaction.id}`);
        console.log(`Deploy fees are  ${JSON.stringify(response.fees, null, 2)}`);
        console.log(`Contract is successfully deployed. You can play with your multisig wallet now at ${address}`);

        process.exit(0);

    } catch (error) {
        console.error(error);
        process.exit(1);
    }
})();
