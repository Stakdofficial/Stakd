import fs from 'fs'
import crypto from 'crypto'
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
const disc = (n: string) => Buffer.from(crypto.createHash('sha256').update(`global:${n}`).digest()).subarray(0, 8)
;(async () => {
  const d = JSON.parse(fs.readFileSync('deployments/solana-testnet/OFT.json', 'utf8'))
  const c = new Connection('https://api.devnet.solana.com', 'confirmed')
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('.keys/devnet.json', 'utf8'))))
  const programId = new PublicKey(d.programId), store = new PublicKey(d.oftStore), mint = new PublicKey(d.mint)
  const srcEid = 40451
  const [peer] = PublicKey.findProgramAddressSync([Buffer.from('Peer'), store.toBuffer(), Buffer.from(new Uint8Array([(srcEid>>24)&255,(srcEid>>16)&255,(srcEid>>8)&255,srcEid&255]))], programId)
  const params = Buffer.concat([
    Buffer.from(new Uint8Array(new Uint32Array([srcEid]).buffer)),
    Buffer.alloc(32), // to
    Buffer.from(new Uint8Array(new BigUint64Array([1000000000n]).buffer)),
    Buffer.from(new Uint8Array(new BigUint64Array([0n]).buffer)),
    Buffer.from(new Uint8Array(new Uint32Array([0]).buffer)), // options len
    Buffer.from([0]), // compose_msg None
    Buffer.from([0]), // pay_in_lz_token false
  ])
  const ix = new TransactionInstruction({ programId, keys: [
    { pubkey: store, isSigner: false, isWritable: false },
    { pubkey: peer, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
  ], data: Buffer.concat([disc('quote_oft'), params]) })
  const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: (await c.getLatestBlockhash()).blockhash }).add(ix)
  const sim = await c.simulateTransaction(tx, undefined, false)
  console.log((sim.value.logs || []).filter(l => /Error|Paused|invoke|success|failed/.test(l)).join('\n'))
})()
