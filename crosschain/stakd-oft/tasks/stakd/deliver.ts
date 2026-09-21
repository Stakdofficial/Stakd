/**
 * Stakd cross-chain Phase 0 — deliver a verified message on Solana by hand.
 *
 * LayerZero's own executor does not run the Robinhood-testnet -> Solana-devnet route, and the
 * stock `lz:oft:solana:retry-message` task builds `lz_receive` with an account order its SDK
 * version assumes, which this program rejects (it lands on the wrong account and reports
 * "Paused" even though the OFT Store is not paused).
 *
 * So we do what an executor does: ask the program itself, via `lz_receive_types`, which
 * accounts the message needs, then call `lz_receive` with exactly that list.
 *
 *   npx ts-node tasks/stakd/deliver.ts --nonce 2 \
 *     --guid 0x… --message 0x… --src-eid 40451 \
 *     --sender 0x0000000000000000000000009f0045e5f84878dc0ef8114624b605dc465f98cf
 */
import fs from 'fs'

import * as anchor from '@coral-xyz/anchor'
import {
    ComputeBudgetProgram,
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
} from '@solana/web3.js'
import { getMint, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'

function arg(name: string, fallback?: string): string {
    const i = process.argv.indexOf(`--${name}`)
    const v = i === -1 ? fallback : process.argv[i + 1]
    if (v === undefined) throw new Error(`missing --${name}`)
    return v
}

const hexToBytes = (h: string) => Buffer.from(h.replace(/^0x/, ''), 'hex')

// anchor's 8-byte instruction discriminator: sha256("global:<snake_case_name>")[0..8]
function discriminator(name: string): Buffer {
    return Buffer.from(require('crypto').createHash('sha256').update(`global:${name}`).digest()).subarray(0, 8)
}

async function main() {
    const rpc = arg('rpc', 'https://api.devnet.solana.com')
    const keypairPath = arg('keypair', '.keys/devnet.json')
    const deployment = JSON.parse(fs.readFileSync(arg('deployment', 'deployments/solana-testnet/OFT.json'), 'utf8'))
    const programId = new PublicKey(deployment.programId)
    const oftStore = new PublicKey(deployment.oftStore)
    const mint = new PublicKey(deployment.mint)

    const srcEid = Number(arg('src-eid'))
    const nonce = BigInt(arg('nonce'))
    const sender = hexToBytes(arg('sender')) // 32 bytes
    const guid = hexToBytes(arg('guid')) // 32 bytes
    const message = hexToBytes(arg('message'))

    const connection = new Connection(rpc, 'confirmed')
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8'))))

    const supplyBefore = (await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)).supply
    console.log(`supply before : ${Number(supplyBefore) / 1e9}`)

    // ---- 1. ask the program which accounts this message needs -------------------
    // lz_receive_types(params) -> Vec<LzAccount { pubkey, is_signer, is_writable }>
    const paramsLayout = Buffer.concat([
        Buffer.from(new Uint8Array(new Uint32Array([srcEid]).buffer)), // src_eid u32
        sender, // sender [u8;32]
        Buffer.from(new Uint8Array(new BigUint64Array([nonce]).buffer)), // nonce u64
        guid, // guid [u8;32]
        Buffer.from(new Uint8Array(new Uint32Array([message.length]).buffer)), // message len
        message,
        Buffer.from(new Uint8Array(new Uint32Array([0]).buffer)), // extra_data len 0
    ])

    const typesIx = new TransactionInstruction({
        programId,
        keys: [
            { pubkey: oftStore, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
        ],
        data: Buffer.concat([discriminator('lz_receive_types'), paramsLayout]),
    })

    const sim = await connection.simulateTransaction(
        new Transaction({ feePayer: payer.publicKey, recentBlockhash: (await connection.getLatestBlockhash()).blockhash }).add(typesIx),
        undefined,
        false
    )
    if (!sim.value.returnData?.data) {
        console.error(sim.value.logs?.join('\n'))
        throw new Error('lz_receive_types returned nothing')
    }
    const raw = Buffer.from(sim.value.returnData.data[0], 'base64')
    const count = raw.readUInt32LE(0)
    const keys = []
    let o = 4
    for (let i = 0; i < count; i++) {
        keys.push({
            pubkey: new PublicKey(raw.subarray(o, o + 32)),
            isSigner: raw[o + 32] === 1,
            isWritable: raw[o + 33] === 1,
        })
        o += 34
    }
    // the first account is the payer placeholder — it must be us, and must sign
    keys[0] = { pubkey: payer.publicKey, isSigner: true, isWritable: true }
    console.log(`accounts required: ${keys.length}`)
    const NAMES = ['payer','peer','oft_store','token_escrow','to_address','token_dest','token_mint','mint_authority','token_program','associated_token_program','system_program','event_authority','program']
    keys.forEach((k, i) => console.log(`  [${i}] ${NAMES[i] ?? 'remaining'} = ${k.pubkey.toBase58()}${k.isSigner ? ' (signer)' : ''}${k.isWritable ? ' (w)' : ''}`))
    console.log(`  expected oft_store = ${oftStore.toBase58()}`)

    // ---- 2. call lz_receive with exactly those accounts -------------------------
    const ix = new TransactionInstruction({
        programId,
        keys,
        data: Buffer.concat([discriminator('lz_receive'), paramsLayout]),
    })

    const tx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
        .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }))
        .add(ix)

    const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' })
    const supplyAfter = (await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)).supply

    console.log(`delivered     : ${sig}`)
    console.log(`supply after  : ${Number(supplyAfter) / 1e9}`)
    console.log(`minted        : ${(Number(supplyAfter) - Number(supplyBefore)) / 1e9}`)
    console.log(
        supplyAfter > supplyBefore
            ? '\n✅ the tokens burned on Robinhood Chain were minted on Solana — one supply, two chains'
            : '\n❌ nothing was minted'
    )
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
