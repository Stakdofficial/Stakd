/**
 * Stakd cross-chain Phase 0 — hand the Token-2022 mint to the OFT Store's multisig.
 *
 * MABA mode requires the OFT Store (via its SPL multisig) to be the mint authority before
 * any cross-chain transfer, so it can mint on arrival and burn on departure. The stock
 * `lz:oft:solana:setauthority` task builds its multisig against the classic SPL Token
 * program, which a Token-2022 mint rejects — so we set the authority directly here,
 * against the multisig that `lz:oft:solana:create` already made with the right program.
 *
 *   npx ts-node tasks/stakd/handover.ts --keypair .keys/devnet.json
 */
import fs from 'fs'

import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { AuthorityType, TOKEN_2022_PROGRAM_ID, getMint, setAuthority } from '@solana/spl-token'

function arg(name: string, fallback?: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? fallback : process.argv[i + 1]
}

async function main() {
    const rpc = arg('rpc', 'https://api.devnet.solana.com')!
    const keypairPath = arg('keypair', '.keys/devnet.json')!
    const deployment = JSON.parse(fs.readFileSync(arg('deployment', 'deployments/solana-testnet/OFT.json')!, 'utf8'))

    const connection = new Connection(rpc, 'confirmed')
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8'))))
    const mint = new PublicKey(deployment.mint)
    const multisig = new PublicKey(deployment.mintAuthority)

    const before = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)
    console.log(`mint             ${mint.toBase58()}`)
    console.log(`mint authority   ${before.mintAuthority?.toBase58() ?? 'none'} (before)`)

    if (before.mintAuthority?.equals(multisig)) {
        console.log('already handed over — nothing to do')
        return
    }

    const sig = await setAuthority(
        connection,
        payer,
        mint,
        payer, // current mint authority
        AuthorityType.MintTokens,
        multisig, // the OFT Store multisig
        [],
        { commitment: 'confirmed' },
        TOKEN_2022_PROGRAM_ID
    )

    const after = await getMint(connection, mint, 'confirmed', TOKEN_2022_PROGRAM_ID)
    console.log(`mint authority   ${after.mintAuthority?.toBase58()} (after)`)
    console.log(`tx               ${sig}`)
    console.log(
        after.mintAuthority?.equals(multisig)
            ? '\n✅ the OFT Store can now mint/burn this Token-2022 mint across chains'
            : '\n❌ handover failed'
    )
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
