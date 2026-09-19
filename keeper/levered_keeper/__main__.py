import argparse
import asyncio
import logging

from . import config
from .runner import Keeper, flatten, resume, status


def main() -> None:
    parser = argparse.ArgumentParser(prog="levered-keeper")
    parser.add_argument("command", choices=["run", "once", "status", "flatten", "resume", "register-api-key"])
    parser.add_argument("--token", help="coin token address for flatten / resume")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if args.command == "register-api-key":
        from .setup_lighter import register_api_key

        asyncio.run(register_api_key())
        return

    cfg = config.load()
    if args.command == "resume":
        if not args.token:
            parser.error("resume needs --token")
        resume(cfg, args.token)
        return

    async def go():
        if args.command == "status":
            await status(cfg)
        elif args.command == "flatten":
            await flatten(cfg, args.token)
        else:
            keeper = Keeper(cfg)
            try:
                await keeper.run(once=args.command == "once")
            finally:
                await keeper.lighter.close()

    asyncio.run(go())


if __name__ == "__main__":
    main()
