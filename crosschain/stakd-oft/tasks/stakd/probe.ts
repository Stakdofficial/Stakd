// Empirically locate the compiled OFTStore layout: write a distinctive default_fee_bps
// via set_oft_config and see which bytes change.
import fs from 'fs'
import crypto from 'crypto'
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js'
const disc = (n: string) => Buffer.from(crypto.createHash('sha256').update(`global:${n}`).digest()).subarray(0, 8)
;(async () => {
  const d = JSON.parse(fs.readFileSync('deployments/solana-testnet/OFT.json', 'utf8'))
  const c = new Connection('https://api.devnet.solana.com', 'confirmed')
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('.keys/devnet.json', 'utf8'))))
  const store = new PublicKey(d.oftStore)
  const before = (await c.getAccountInfo(store, 'confirmed'))!.data
  // SetOFTConfigParams::DefaultFee(777) -> variant index 2, u16 LE
  const data = Buffer.concat([disc('set_oft_config'), Buffer.from([2]), Buffer.from(new Uint8Array(new Uint16Array([777]).buffer))])
  const ix = new TransactionInstruction({ programId: new PublicKey(d.programId), keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: store, isSigner: false, isWritable: true },
  ], data })
  await sendAndConfirmTransaction(c, new Transaction().add(ix), [payer], { commitment: 'confirmed' })
  const after = (await c.getAccountInfo(store, 'confirmed'))!.data
  for (let i = 0; i < after.length; i++) if (before[i] !== after[i]) console.log(`byte ${i}: ${before[i]} -> ${after[i]}`)
  console.log('777 = 0x0309 -> expect bytes [09,03] at the default_fee_bps offset (source says 154)')
})()
