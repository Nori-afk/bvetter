#!/usr/bin/env python3
"""
Generate a synthetic consultation workbook for a PARTIAL year, resampled from
the clinic's real records.

WHY THIS EXISTS
---------------
Demonstrating the upload -> merge -> forecast pipeline needs a "next year" file,
and the clinic's real encoding for that year is not finished. Building one by
hand went wrong in three specific ways that this script exists to avoid:

  1. FUTURE DATES. The hand-made file ran to 2026-12-31 while the year was only
     part over, so roughly 800 of its 2,638 rows described consultations that
     had not happened. A forecaster trained on those is trained on the very
     period it claims to predict. This script never emits a date after today.

  2. A CONSTANT cases_reported. Every hand-made row carried 1, where the real
     records run 1/2/3 at roughly 59/29/12 percent (mean 1.54). That left the
     generated year's case totals about a third short of what the same activity
     produces in the real years, so the merged series flattened exactly where it
     should have continued.

  3. IMPLAUSIBLE VOLUME. Every hand-made month held 200-233 consultations
     against a real range of 116-158, and held it far too evenly.

WHY IT TARGETS CASES RATHER THAN ROW COUNTS
-------------------------------------------
The first version of this script drew a row count per month and let the cases
fall where they may. The distributions came out right and the forecast still
degraded badly: pooled MAE went from 2.58 on the real years to 32.25, and MAPE
from 1.2% to 16.5%.

The reason is that the real municipality series is very nearly deterministic.
Strip each year's level and the monthly seasonal index and the residual has a
standard deviation of ~1.0% of a month. SARIMA fits that to 1.2% MAPE. Drawing
row counts with 5% jitter, then adding the variance of resampled cases_reported
on top, produced a series several times noisier than the real one -- so the
holdout months became unpredictable and the reported accuracy collapsed.

So months are now filled to a CASE target taken from the measured seasonal
index and the last real year's level, with ~1% noise: the same structure the
model already fits, continued rather than approximated. Row counts fall out of
that, and land in the real range on their own.

RESAMPLING RATHER THAN MODELLING. Whole rows are drawn with replacement from the
real data, so barangay, diagnosis, animal group, symptom cluster and
cases_reported keep not only their individual distributions but their
correlations -- every emitted row is a combination that actually occurred.

The output is honest about itself: each row's `system_use` column carries its
provenance, so the marker survives an export or a screenshot in a way a filename
does not.

    py tools/generate_synthetic_consultations.py
    py tools/generate_synthetic_consultations.py --months 7 --seed 20260909
"""

import argparse
import os
import sys
from calendar import monthrange
from datetime import date

import numpy as np
import pandas as pd

SHEET = "Consult_Diagnosis_3Y"

# The ingest's column list (bv_consult_columns() in
# api/includes/dataset_versions.php). Emitted in this order so the workbook
# reads like the ones the clinic already produces.
COLUMNS = [
    "consultation_id", "consultation_date", "year", "month_no", "month",
    "barangay_id", "barangay", "animal_group", "diagnosis", "disease_category",
    "symptom_cluster", "cases_reported", "frequency_code",
    "frequency_description", "season_pattern", "risk_level", "basis",
    "system_use",
]

MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]

PROVENANCE = "synthetic: bootstrap resample of {years} records (seed {seed})"

# Matches the residual measured on the real series once level and season are
# removed (std ~1.0% of a month). Higher values make the generated months less
# predictable than the real ones and visibly degrade reported accuracy.
DEFAULT_NOISE = 0.01


def read_source(path):
    """The real consultations, with the header row found rather than assumed."""
    probe = pd.read_excel(path, sheet_name=SHEET, header=None)
    header_row = None
    for i, row in probe.iterrows():
        labels = {str(v).strip().lower() for v in row.values if pd.notna(v)}
        if {"year", "consultation_id", "diagnosis"} <= labels:
            header_row = i
            break
    if header_row is None:
        sys.exit("No header row containing consultation_id/year/diagnosis in " + path)

    df = pd.read_excel(path, sheet_name=SHEET, header=header_row)
    df.columns = [str(c).strip().lower() for c in df.columns]
    df = df[df["year"].apply(lambda v: str(v).strip().isdigit())]
    df["year"] = df["year"].astype(int)
    df["month_no"] = pd.to_numeric(df["month_no"], errors="coerce").fillna(1).astype(int)
    df["cases_reported"] = pd.to_numeric(df["cases_reported"], errors="coerce").fillna(1).astype(int)
    return df.reset_index(drop=True)


def seasonal_profile(df):
    """
    The monthly seasonal index, and the most recent year's mean monthly cases.

    The index is each calendar month's share of its own year's average, averaged
    across years -- so it describes shape independently of how busy a year was,
    and the level is supplied separately.
    """
    monthly = df.groupby(["year", "month_no"])["cases_reported"].sum().unstack()
    normalised = monthly.div(monthly.mean(axis=1), axis=0)
    index = normalised.mean()
    last_year = int(monthly.index.max())
    level = float(monthly.loc[last_year].mean())
    return index, level, monthly


def case_targets(index, level, months, rng, noise):
    """
    Cases to emit per month: the level carried forward, shaped by the seasonal
    index, perturbed only as much as the real series is.
    """
    targets = {}
    for month in months:
        expected = level * float(index.get(month, 1.0))
        targets[month] = max(1, int(round(expected * (1.0 + rng.normal(0.0, noise)))))
    return targets


def build(df, year, months, targets, seed, rng, cutoff):
    """Fill each month with resampled real rows until its case target is met."""
    source_years = "-".join(str(y) for y in sorted(df["year"].unique()))
    stamp = PROVENANCE.format(years=source_years, seed=seed)
    pool = df.reset_index(drop=True)

    rows, serial = [], 0
    for month in months:
        last_day = monthrange(year, month)[1]
        emitted = 0
        # Drawn in blocks and topped up, rather than one .sample() call per row:
        # the target is in CASES and each row contributes 1-3 of them, so the
        # row count is not known in advance.
        while emitted < targets[month]:
            block = pool.sample(n=64, replace=True,
                                random_state=int(rng.integers(0, 2 ** 31 - 1)))
            for _, src in block.iterrows():
                if emitted >= targets[month]:
                    break
                serial += 1
                when = date(year, month, int(rng.integers(1, last_day + 1)))
                # Never emit a consultation that has not happened yet. Clamped
                # rather than dropped, so the month still reaches its target.
                if when > cutoff:
                    when = cutoff
                row = {c: src.get(c, "") for c in COLUMNS}
                row.update({
                    "consultation_id":   "CONS-%d-%05d" % (year, serial),
                    "consultation_date": when.strftime("%Y-%m-%d"),
                    "year":              year,
                    "month_no":          month,
                    "month":             MONTH_NAMES[month - 1],
                    "system_use":        stamp,
                })
                rows.append(row)
                emitted += int(src.get("cases_reported", 1) or 1)
    return pd.DataFrame(rows, columns=COLUMNS)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)

    ap = argparse.ArgumentParser(
        description="Resample the real consultations into a synthetic partial year.")
    ap.add_argument("--source",
                    default=os.path.join(root, "database", "BaliwagVet_2023-2025.xlsx"))
    ap.add_argument("--out", default=None, help="output .xlsx (default: beside this script)")
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--months", type=int, default=7,
                    help="emit months 1..N (default 7 = Jan-Jul)")
    ap.add_argument("--level", type=float, default=None,
                    help="mean monthly CASES (default: the last real year's mean)")
    ap.add_argument("--noise", type=float, default=DEFAULT_NOISE,
                    help="month-to-month noise, as a fraction (default matches the real series)")
    ap.add_argument("--seed", type=int, default=20260909,
                    help="fixed so the same file can be regenerated")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    months = list(range(1, args.months + 1))

    df = read_source(args.source)
    index, level, monthly = seasonal_profile(df)
    level = args.level if args.level is not None else level
    targets = case_targets(index, level, months, rng, args.noise)
    generated = build(df, args.year, months, targets, args.seed, rng, date.today())

    out = args.out or os.path.join(
        here, "%d_consult_synthetic_jan-%s.xlsx"
              % (args.year, MONTH_NAMES[args.months - 1][:3].lower()))
    generated.to_excel(out, sheet_name=SHEET, index=False)

    print("wrote " + out)
    print("\nreal source (%d rows)" % len(df))
    for year, grp in df.groupby("year"):
        cases = int(grp["cases_reported"].sum())
        print("  %d: %5d rows  %5d cases  %.2f per row  (%.1f cases/month)"
              % (year, len(grp), cases, cases / len(grp), cases / 12.0))
    print("\ncarried level: %.1f cases/month   noise: %.1f%%" % (level, 100 * args.noise))

    total_cases = int(generated["cases_reported"].sum())
    print("\ngenerated %d (%d rows)" % (args.year, len(generated)))
    for month in months:
        sub = generated[generated["month_no"] == month]
        print("  %s: %4d rows  %4d cases  (target %4d, index %.3f)"
              % (MONTH_NAMES[month - 1][:3], len(sub), int(sub["cases_reported"].sum()),
                 targets[month], float(index.get(month, 1.0))))
    print("  TOTAL: %d rows  %d cases  %.2f per row"
          % (len(generated), total_cases, total_cases / len(generated)))
    print("  dates: %s .. %s" % (generated["consultation_date"].min(),
                                 generated["consultation_date"].max()))


if __name__ == "__main__":
    main()
