/**
 * Stakd cross-chain Phase 0 — Solana fee-burn proof.
 *
 * Proves the Solana half of "one coin, two chains":
 *   trade the coin on Solana -> Token-2022 withholds the fee IN THE COIN -> the fee is
 *   swept to the mint and burned -> total supply drops. No bridging, no selling.
 *
 * Run against a local validator (free) or devnet:
 *   npx ts-node tasks/stakd/feeBurn.ts --rpc http://127.0.0.1:8899 --keypair .keys/devnet.json
 *   npx ts-node tasks/stakd/feeBurn.ts --rpc https://api.devnet.solana.com --keypair .keys/devnet.json
 *
 * Optional: --mint <existing Token-2022 mint> to run the sweep+burn against a mint that
 * already exists (e.g. the one handed to the LayerZero OFT Store in MABA mode).
 */
import fs from 'fs'

import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js'
import {
    ExtensionType,
    TOKEN_2022_PROGRAM_ID,
    burn,
    createAccount,
    createAssociatedTokenAccountIdempotent,
    createInitializeMintInstruction,
    createInitializeTransferFeeConfigInstruction,
    getAccount,
    getMint,
    getMintLen,
    getTransferFeeAmount,
    harvestWithheldTokensToMint,
    mintTo,
    transferCheckedWithFee,
    unpackAccount,
} from '@solana/spl-token'

const DECIMALS = 9
const FEE_BPS = 300 // 3% — the Solana-side trading fee, taken in the coin
const MAX_FEE = BigInt('18446744073709551615') // no cap
const SUPPLY = BigInt(1_000_000_000) * BigInt(10 ** DECIMALS) // 1B, same as an RH Chain Stakd coin

function arg(name: string, fallback?: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? fallback : process.argv[i + 1]
}

const fmt = (raw: bigint) => (Number(raw) / 10 ** DECIMALS).toLocaleString('en-US', { maximumFractionDigits: 4 })

async function main() {
    const rpc = arg('rpc', 'http://127.0.0.1:8899')!
    const keypairPath = arg('keypair', '.keys/devnet.json')!
    const existingMint = arg('mint')

    const connection = new Connection(rpc, 'confirmed')
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8'))))
    console.log(`rpc      ${rpc}`)
    console.log(`payer    ${payer.publicKey.toBase58()}`)

    let balance = await connection.getBalance(payer.publicKey)
    if (balance < 0.5 * LAMPORTS_PER_SOL && rpc.includes('127.0.0.1')) {
        const sig = await connection.requestAirdrop(payer.publicKey, 5 * LAMPORTS_PER_SOL)
        await connection.confirmTransaction(sig, 'confirmed')
        balance = await connection.getBalance(payer.publicKey)
    }
    console.log(`balance  ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL\n`)
    if (balance === 0) throw new Error('payer has no SOL — fund it before running')

    // ---------------------------------------------------------------- 1. the mint
    let mint: PublicKey
    if (existingMint) {
        mint = new PublicKey(existingMint)
        console.log(`1. using existing Token-2022 mint ${mint.toBase58()}`)
    } else {
        const mintKp = Keypair.generate()
        mint = mintKp.publicKey
        const mintLen = getMintLen([ExtensionType.TransferFeeConfig])
        const lamports = await connection.getMinimumBalanceForRentExemption(mintLen)
        const tx = new Transaction().add(
            SystemProgram.createAccount({
                fromPubkey: payer.publicKey,
                newAccountPubkey: mint,
                space: mintLen,
                lamports,
                programId: TOKEN_2022_PROGRAM_ID,
            }),
            // transfer-fee config: the fee authority can never raise it past what we set,
            // and the withdraw authority is the only key that can move withheld fees.
            createInitializeTransferFeeConfigInstruction(
                mint,
                payer.publicKey, // transfer fee config authority (set to null in production to freeze the fee)
                payer.publicKey, // withdraw withheld authority (the keeper)
                FEE_BPS,
                MAX_FEE,
                TOKEN_2022_PROGRAM_ID
            ),
            createInitializeMintInstruction(mint, DECIMALS, payer.publicKey, null, TOKEN_2022_PROGRAM_ID)
        )
        await sendAndConfirmTransaction(connection, tx, [payer, mintKp], { commitment: 'confirmed' })
        console.log(`1. created Token-2022 mint ${mint.toBase58()} with a ${FEE_BPS / 100}% transfer fee`)
    }

    // -------------------------------------------------------- 2. supply + traders
    const pool = await createAssociatedTokenAccountIdempotent(
        connection,
        payer,
        mint,
        payer.publicKey,
        { commitment: 'confirmed' },
        TOKEN_2022_PROGRAM_ID
    )
    const mintInfo = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)
    const startSupply = mintInfo.supply
    const amountToMint = existingMint ? BigInt(10_000) * BigInt(10 ** DECIMALS) : SUPPLY
    if (startSupply === BigInt(0)) {
        // Once the mint has been handed to the OFT Store, its authority is an SPL multisig
        // that lists both the OFT Store and us; we sign as one of its members.
        const authority = mintInfo.mintAuthority!
        const viaMultisig = !authority.equals(payer.publicKey)
        await mintTo(
            connection,
            payer,
            mint,
            pool,
            authority,
            amountToMint,
            viaMultisig ? [payer] : [],
            { commitment: 'confirmed' },
            TOKEN_2022_PROGRAM_ID
        )
        console.log(`2. minted ${fmt(amountToMint)} into the "pool" account${viaMultisig ? ' (via the OFT multisig)' : ''}`)
    } else {
        console.log(`2. mint already has supply ${fmt(startSupply)}`)
    }

    const traders: PublicKey[] = []
    for (let i = 0; i < 3; i++) {
        const kp = Keypair.generate()
        traders.push(
            await createAccount(
                connection,
                payer,
                mint,
                kp.publicKey,
                Keypair.generate(),
                { commitment: 'confirmed' },
                TOKEN_2022_PROGRAM_ID
            )
        )
    }
    console.log(`   opened ${traders.length} trader accounts`)

    const supplyBefore = (await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)).supply
    console.log(`\n   supply before trading: ${fmt(supplyBefore)}\n`)

    // ------------------------------------------------------------- 3. simulate buys
    console.log('3. simulating trades (each one pays the fee in the coin):')
    let expectedFees = BigInt(0)
    const sizes = (existingMint ? [BigInt(50), BigInt(25), BigInt(10)] : [BigInt(5_000_000), BigInt(1_250_000), BigInt(9_400_000)]).map(
        (n) => n * BigInt(10 ** DECIMALS)
    )
    for (let i = 0; i < sizes.length; i++) {
        const amount = sizes[i]
        const fee = (amount * BigInt(FEE_BPS)) / BigInt(10_000)
        expectedFees += fee
        await transferCheckedWithFee(
            connection,
            payer,
            pool,
            mint,
            traders[i],
            payer,
            amount,
            DECIMALS,
            fee,
            [],
            { commitment: 'confirmed' },
            TOKEN_2022_PROGRAM_ID
        )
        console.log(`   trade ${i + 1}: ${fmt(amount)} traded -> ${fmt(fee)} withheld as fee`)
    }

    // -------------------------------------------- 4. find every account holding fees
    // Public RPCs often refuse getProgramAccounts on the token programs, so scan the accounts
    // we know about and fall back to a full scan where the RPC allows it. A production keeper
    // tracks holders from the pool's trade history the same way.
    const candidates: PublicKey[] = [pool, ...traders]
    let scanned: readonly { pubkey: PublicKey; account: any }[] = []
    try {
        scanned = await connection.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
            commitment: 'confirmed',
            filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
        })
    } catch {
        scanned = await Promise.all(
            candidates.map(async (pubkey) => ({ pubkey, account: (await connection.getAccountInfo(pubkey, 'confirmed'))! }))
        )
    }
    const withFees: PublicKey[] = []
    let withheldTotal = BigInt(0)
    for (const acc of scanned) {
        if (!acc.account) continue
        const unpacked = unpackAccount(acc.pubkey, acc.account, TOKEN_2022_PROGRAM_ID)
        const withheld = getTransferFeeAmount(unpacked)?.withheldAmount ?? BigInt(0)
        if (withheld > BigInt(0)) {
            withFees.push(acc.pubkey)
            withheldTotal += withheld
        }
    }
    console.log(`\n4. found ${withFees.length} accounts holding ${fmt(withheldTotal)} in withheld fees`)

    // --------------------------------------------------- 5. sweep to mint, then burn
    await harvestWithheldTokensToMint(connection, payer, mint, withFees, { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID)
    console.log('5. swept withheld fees to the mint (permissionless — anyone can call this)')

    // Withdraw the swept fees into an account we can burn from. In production this
    // authority is the Stakd keeper and the tokens are burned in the same transaction.
    const { withdrawWithheldTokensFromMint } = await import('@solana/spl-token')
    const burnVault = await createAccount(
        connection,
        payer,
        mint,
        payer.publicKey, // owned by the keeper, so it can burn from it
        Keypair.generate(),
        { commitment: 'confirmed' },
        TOKEN_2022_PROGRAM_ID
    )
    await withdrawWithheldTokensFromMint(
        connection,
        payer,
        mint,
        burnVault,
        payer,
        [],
        { commitment: 'confirmed' },
        TOKEN_2022_PROGRAM_ID
    )
    const vault = await getAccount(connection, burnVault, 'confirmed', TOKEN_2022_PROGRAM_ID)
    console.log(`   withdrew ${fmt(vault.amount)} of fees into the burn vault`)

    await burn(connection, payer, burnVault, mint, payer, vault.amount, [], { commitment: 'confirmed' }, TOKEN_2022_PROGRAM_ID)
    const supplyAfter = (await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)).supply

    console.log(`\n6. BURNED ${fmt(vault.amount)} tokens`)
    console.log(`   supply before : ${fmt(supplyBefore)}`)
    console.log(`   supply after  : ${fmt(supplyAfter)}`)
    console.log(`   difference    : -${fmt(supplyBefore - supplyAfter)}`)

    const ok = supplyBefore - supplyAfter === expectedFees && expectedFees > BigInt(0)
    console.log(`\n${ok ? '✅ PASS' : '❌ FAIL'} — supply fell by exactly the fees collected (${fmt(expectedFees)})`)
    if (!ok) process.exit(1)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
