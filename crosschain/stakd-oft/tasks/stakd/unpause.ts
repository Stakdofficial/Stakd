// Explicitly write paused=false on the OFT Store via set_oft_config(Paused(false)).
import fs from 'fs'
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'
import crypto from 'crypto'

const disc = (n: string) => Buffer.from(crypto.createHash('sha256').update(`global:${n}`).digest()).subarray(0, 8)

async function main() {
    const d = JSON.parse(fs.readFileSync('deployments/solana-testnet/OFT.json', 'utf8'))
    const c = new Connection('https://api.devnet.solana.com', 'confirmed')
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('.keys/devnet.json', 'utf8'))))
    // SetOFTConfigParams::Paused(false) -> enum index 3, then bool
    const data = Buffer.concat([disc('set_oft_config'), Buffer.from([3, 0])])
    const ix = new TransactionInstruction({
        programId: new PublicKey(d.programId),
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: new PublicKey(d.oftStore), isSigner: false, isWritable: true },
        ],
        data,
    })
    const sig = await sendAndConfirmTransaction(c, new Transaction().add(ix), [payer], { commitment: 'confirmed' })
    console.log('set paused=false:', sig)
}
main().catch((e) => { console.error(e?.transactionLogs ?? e); process.exit(1) })
