const {Connection,PublicKey}=require('@solana/web3.js');
const {getMint,getAccount,getAssociatedTokenAddressSync,TOKEN_2022_PROGRAM_ID}=require('@solana/spl-token');
(async()=>{
  const c=new Connection('https://api.mainnet-beta.solana.com','confirmed');
  const m=new PublicKey('YZyt4fEVtK96K1tD4ofvGKDeQXS78kb7DzBgDT3MMrX');
  const me=new PublicKey('2zPifai7paxqMDYscPZB1k8bRiD5pD8zteyf8gy9zdm4');
  for(let i=0;i<40;i++){
    const s=Number((await getMint(c,m,'confirmed',TOKEN_2022_PROGRAM_ID)).supply)/1e9;
    let bal=0; try{const ata=getAssociatedTokenAddressSync(m,me,false,TOKEN_2022_PROGRAM_ID);bal=Number((await getAccount(c,ata,'confirmed',TOKEN_2022_PROGRAM_ID)).amount)/1e9}catch(e){}
    console.log(new Date().toISOString().slice(11,19),'solana supply',s,'| my balance',bal);
    if(s>0){console.log('ARRIVED');break}
    await new Promise(r=>setTimeout(r,20000));
  }
})()
