// Signs and sends the Solana side of a Relay order: the user's wallet pays SOL, Relay's solver
// delivers ETH to the order address on Robinhood Chain.
const fs=require('fs');
const {Connection,Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,AddressLookupTableAccount}=require('@solana/web3.js');
(async()=>{
  const q=JSON.parse(fs.readFileSync('/tmp/relay_order.json','utf8'));
  const d=q.steps[0].items[0].data;
  const kp=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync('.keys/solana-mainnet.json','utf8'))));
  const c=new Connection('https://api.mainnet-beta.solana.com','confirmed');

  const ixs=d.instructions.map(i=>new TransactionInstruction({
    programId:new PublicKey(i.programId),
    keys:i.keys.map(k=>({pubkey:new PublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable})),
    data:Buffer.from(i.data,'hex').length? Buffer.from(i.data,'hex'):Buffer.from(i.data,'base64'),
  }));

  const luts=[];
  for(const a of (d.addressLookupTableAddresses||[])){
    const r=await c.getAddressLookupTable(new PublicKey(a));
    if(r.value) luts.push(r.value);
  }

  const {blockhash}=await c.getLatestBlockhash('confirmed');
  const msg=new TransactionMessage({payerKey:kp.publicKey,recentBlockhash:blockhash,instructions:ixs}).compileToV0Message(luts);
  const tx=new VersionedTransaction(msg);
  tx.sign([kp]);
  const sig=await c.sendRawTransaction(tx.serialize(),{maxRetries:5});
  console.log('solana tx:', sig);
  await c.confirmTransaction(sig,'confirmed');
  console.log('confirmed at', new Date().toISOString());
})().catch(e=>{console.error(String(e.message||e).slice(0,400));process.exit(1)});
