"""
CLI: ``python -m ci.hbpe.evaluation --user <uuid>``

Reads the user's L0 token stream and prints the walk-forward table.  Needs
database access; ``--with-hmt`` additionally needs a served checkpoint.
"""

from __future__ import annotations

import argparse
import datetime
import json
import logging
import sys

from ci.hbpe.evaluation.forecaster import DEFAULT_FORECASTERS, Forecaster
from ci.hbpe.evaluation.report import render
from ci.hbpe.evaluation.walkforward import walk_forward


def _date(value: str) -> datetime.date:
    return datetime.date.fromisoformat(value)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ci.hbpe.evaluation")
    parser.add_argument("--user", required=True, help="user UUID")
    parser.add_argument(
        "--min-history-days",
        type=int,
        default=14,
        help="distinct earlier days required before a day is scored (default 14)",
    )
    parser.add_argument("--start", type=_date, help="first eval day (inclusive)")
    parser.add_argument("--end", type=_date, help="last eval day (inclusive)")
    parser.add_argument(
        "--with-hmt",
        action="store_true",
        help="include the deployed transformer (needs a checkpoint)",
    )
    parser.add_argument("--json", action="store_true", help="emit JSON, not a table")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    from ci.hbpe.pipeline.baselines import fetch_occupancy_rows

    rows = fetch_occupancy_rows(args.user)
    if not rows:
        print(f"no L0 token_stream rows for user {args.user}", file=sys.stderr)
        return 1

    forecasters: list[Forecaster] = list(DEFAULT_FORECASTERS)
    candidate = None
    if args.with_hmt:
        from ci.hbpe.evaluation.hmt import HmtForecaster

        forecasters.append(HmtForecaster(args.user))
        candidate = "hmt"

    result = walk_forward(
        rows,
        forecasters,
        min_history_days=args.min_history_days,
        start=args.start,
        end=args.end,
    )
    if not result.scores:
        print("no eligible eval days — corpus too short", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result.as_dict(), indent=2))
    else:
        print(render(result, candidate=candidate))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
