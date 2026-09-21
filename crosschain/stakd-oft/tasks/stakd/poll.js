// Watches the Solana mint for the +1000 that the Robinhood-testnet send should mint on arrival.
const {Connection,PublicKey}=require('@solana/web3.js');
const {getMint,TOKEN_2022_PROGRAM_ID}=require('@solana/spl-token');
(async()=>{
  const c=new Connection('https://api.devnet.solana.com','confirmed');
  const m=new PublicKey('3rMaPRZmG8qu4CzxXrnSirRtmSfJRGvxaKc7RHPxPYhn');
  const base=Number((await getMint(c,m,'confirmed',TOKEN_2022_PROGRAM_ID)).supply)/1e9;
  console.log('baseline supply',base,'— waiting for +1000 from the bridge');
  for(let i=0;i<120;i++){
    const s=Number((await getMint(c,m,'confirmed',TOKEN_2022_PROGRAM_ID)).supply)/1e9;
    if(s>base+0.5){console.log(new Date().toISOString().slice(11,19),'ARRIVED: supply',base,'->',s,'(+'+(s-base)+')');break}
    if(i%5===0)console.log(new Date().toISOString().slice(11,19),'still',s);
    await new Promise(r=>setTimeout(r,30000));
  }
})()
