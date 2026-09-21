/**
 * Stakd cross-chain Phase 0 — create the Solana-side Token-2022 mint.
 *
 * This is the mint that later gets handed to the LayerZero OFT Store in
 * Mint-And-Burn-Adapter (MABA) mode, which is the only mode that accepts a
 * custom token program. It carries the TransferFeeConfig extension: the
 * Solana-side trading fee, taken in the coin, which the keeper sweeps and burns.
 *
 *   npx ts-node tasks/stakd/createMint.ts --rpc https://api.devnet.solana.com \
 *       --keypair .keys/devnet.json --fee-bps 300 --decimals 9
 *
 * Prints the mint address to pass to `lz:oft:solana:create --mint <addr>`.
 */
import fs from 'fs'

import {
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
    AuthorityType,
    ExtensionType,
    TOKEN_2022_PROGRAM_ID,
    createInitializeMintInstruction,
    createInitializeTransferFeeConfigInstruction,
    getMintLen,
    setAuthority,
} from '@solana/spl-token'

function arg(name: string, fallback?: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? fallback : process.argv[i + 1]
}

async function main() {
    const rpc = arg('rpc', 'https://api.devnet.solana.com')!
    const keypairPath = arg('keypair', '.keys/devnet.json')!
    const feeBps = Number(arg('fee-bps', '300'))
    const decimals = Number(arg('decimals', '9'))
    const outPath = arg('out', '.keys/mint.json')!
    // Token-2022 lets the fee authority raise the fee to 100%, which would let whoever holds that key take
    // every transfer. So it is renounced by default: the fee becomes unchangeable, matching the promise that a
    // coin's fee is fixed at launch. Pass --keep-fee-authority only on a throwaway test mint.
    const keepFeeAuthority = process.argv.includes('--keep-fee-authority')
    // Pin the priority fee. Never let a scale factor decide it: a 572 KB program is ~570 transactions, so a bad
    // per-transaction price is what turns a deploy into a multi-SOL bill.
    const priorityFee = Number(arg('priority-fee', '20000'))

    if (feeBps < 0 || feeBps > 500) throw new Error('fee-bps must be 0..500 (Stakd caps coin fees at 5%)')

    const connection = new Connection(rpc, 'confirmed')
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8'))))
    const mintKp = Keypair.generate()

    const mintLen = getMintLen([ExtensionType.TransferFeeConfig])
    const lamports = await connection.getMinimumBalanceForRentExemption(mintLen)

    const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee }),
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: mintKp.publicKey,
            space: mintLen,
            lamports,
            programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeTransferFeeConfigInstruction(
            mintKp.publicKey,
            payer.publicKey, // fee config authority — set to null in production to freeze the fee forever
            payer.publicKey, // withdraw withheld authority — the Stakd keeper
            feeBps,
            BigInt('18446744073709551615'), // no per-transfer cap
            TOKEN_2022_PROGRAM_ID
        ),
        // mint authority stays with us until `lz:oft:solana:create` hands it to the OFT Store
        createInitializeMintInstruction(mintKp.publicKey, decimals, payer.publicKey, null, TOKEN_2022_PROGRAM_ID)
    )

    const sig = await sendAndConfirmTransaction(connection, tx, [payer, mintKp], { commitment: 'confirmed' })
    fs.writeFileSync(outPath, JSON.stringify(Array.from(mintKp.secretKey)))

    if (!keepFeeAuthority) {
        await setAuthority(
            connection,
            payer,
            mintKp.publicKey,
            payer,
            AuthorityType.TransferFeeConfig,
            null, // nobody can ever change this coin's fee again
            [],
            { commitment: 'confirmed' },
            TOKEN_2022_PROGRAM_ID
        )
    }

    console.log(`mint            ${mintKp.publicKey.toBase58()}`)
    console.log(`token program   ${TOKEN_2022_PROGRAM_ID.toBase58()}`)
    console.log(`trading fee     ${feeBps / 100}%  (taken in the coin, swept + burned)`)
    console.log(`fee authority   ${keepFeeAuthority ? 'KEPT — this key can still change the fee' : 'RENOUNCED — the fee can never change'}`)
    console.log(`priority fee    ${priorityFee} microLamports (pinned)`)
    console.log(`decimals        ${decimals}`)
    console.log(`tx              ${sig}`)
    console.log(`keypair saved   ${outPath}`)
    console.log(`\nNext:\n  npx hardhat lz:oft:solana:create --eid 40168 --program-id <OFT_PROGRAM_ID> \\\n    --mint ${mintKp.publicKey.toBase58()} --token-program ${TOKEN_2022_PROGRAM_ID.toBase58()} \\\n    --additional-minters ${payer.publicKey.toBase58()} --name "Stakd Cross Test" --symbol sXTEST`)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
