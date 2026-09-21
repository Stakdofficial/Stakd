/**
 * Stakd cross-chain Phase 0 — initialise the OFT Store ourselves.
 *
 * `lz:oft:solana:create` (LayerZero's SDK) produced a store this program build reads
 * incorrectly: the program logged `token_mint`, `bump` and `paused` as garbage while
 * `admin`, `escrow`, `endpoint` and `ld2sd_rate` were right — so `lz_receive` refused
 * delivery with "Paused". Here we build `init_oft` straight from the program's own IDL,
 * so writer and reader are the same binary, and we make the OFT Store PDA the mint
 * authority directly (the program allows that, and it avoids the SPL multisig entirely).
 *
 *   npx ts-node -T tasks/stakd/initStore.ts --mint <TOKEN2022_MINT>
 */
import fs from 'fs'
import crypto from 'crypto'

import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
} from '@solana/web3.js'
import { AuthorityType, TOKEN_2022_PROGRAM_ID, setAuthority } from '@solana/spl-token'

const disc = (n: string) => Buffer.from(crypto.createHash('sha256').update(`global:${n}`).digest()).subarray(0, 8)
const arg = (name: string, fallback?: string) => {
    const i = process.argv.indexOf(`--${name}`)
    const v = i === -1 ? fallback : process.argv[i + 1]
    if (v === undefined) throw new Error(`missing --${name}`)
    return v
}

async function main() {
    const rpc = arg('rpc', 'https://api.devnet.solana.com')
    const programId = new PublicKey(arg('program-id', 'EcZMksyExkyHwANu9k2FEK5S4a6XZaVM8dBc9dDVsUJW'))
    const mint = new PublicKey(arg('mint'))
    const sharedDecimals = Number(arg('shared-decimals', '6'))

    const connection = new Connection(rpc, 'confirmed')
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(arg('keypair', '.keys/devnet.json'), 'utf8'))))

    // the escrow is a fresh token account the program initialises and owns
    const escrowKp = Keypair.generate()
    const [oftStore] = PublicKey.findProgramAddressSync([Buffer.from('OFT'), escrowKp.publicKey.toBuffer()], programId)
    const [lzTypes] = PublicKey.findProgramAddressSync([Buffer.from('LzReceiveTypes'), oftStore.toBuffer()], programId)
    const ENDPOINT = new PublicKey('76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6')
    const [oappRegistry] = PublicKey.findProgramAddressSync([Buffer.from('OApp'), oftStore.toBuffer()], ENDPOINT)
    const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], ENDPOINT)

    console.log(`mint      ${mint.toBase58()}`)
    console.log(`escrow    ${escrowKp.publicKey.toBase58()}`)
    console.log(`oftStore  ${oftStore.toBase58()}`)

    // InitOFTParams { oft_type: Native(0), admin, shared_decimals, endpoint_program: None }
    const params = Buffer.concat([
        Buffer.from([0]), // OFTType::Native
        payer.publicKey.toBuffer(),
        Buffer.from([sharedDecimals]),
        Buffer.from([0]), // endpoint_program: None -> program default
    ])

    const ix = new TransactionInstruction({
        programId,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true }, // 0 payer
            { pubkey: oftStore, isSigner: false, isWritable: true }, // 1 oft_store
            { pubkey: lzTypes, isSigner: false, isWritable: true }, // 2 lz_receive_types_accounts
            { pubkey: mint, isSigner: false, isWritable: false }, // 3 token_mint
            { pubkey: escrowKp.publicKey, isSigner: true, isWritable: true }, // 4 token_escrow
            { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false }, // 5 token_program
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 6 system_program
            // remaining accounts: the endpoint's register_oapp CPI
            { pubkey: ENDPOINT, isSigner: false, isWritable: false },
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: oftStore, isSigner: false, isWritable: false },
            { pubkey: oappRegistry, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: eventAuthority, isSigner: false, isWritable: false },
            { pubkey: ENDPOINT, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([disc('init_oft'), params]),
    })

    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer, escrowKp], {
        commitment: 'confirmed',
    })
    console.log(`init_oft  ${sig}`)

    // MABA: the mint authority may be the OFT Store itself (no multisig needed)
    await setAuthority(
        connection,
        payer,
        mint,
        payer,
        AuthorityType.MintTokens,
        oftStore,
        [],
        { commitment: 'confirmed' },
        TOKEN_2022_PROGRAM_ID
    )
    console.log(`mint authority -> ${oftStore.toBase58()}`)

    const out = {
        programId: programId.toBase58(),
        mint: mint.toBase58(),
        mintAuthority: oftStore.toBase58(),
        escrow: escrowKp.publicKey.toBase58(),
        oftStore: oftStore.toBase58(),
    }
    fs.writeFileSync('deployments/solana-testnet/OFT.json', JSON.stringify(out, null, 4))
    fs.writeFileSync('.keys/escrow.json', JSON.stringify(Array.from(escrowKp.secretKey)))
    console.log('\nwrote deployments/solana-testnet/OFT.json')
}

main().catch((e) => {
    console.error(e?.transactionLogs ?? e)
    process.exit(1)
})
