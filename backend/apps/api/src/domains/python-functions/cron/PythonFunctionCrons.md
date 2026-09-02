# PythonFunctionCrons.ts

## Purpose

Owns ordinary pg-boss schedules for Python sidecar functions and fans each run
out to onboarded users.

## Smart-rotation contract

When `smart.rotation` is enabled, the ordinary hourly-summary, dossier, and
insight crons stand down to prevent duplicate schedules. The smart-rotation
summary tick dispatches both `hourly_summary` and `dossier_refresh`; its insight
tick dispatches `insights_generation`, whose sidecar owns novelty detection.

Daily/weekly/monthly rollups, actions, and HBPE jobs remain owned here because
smart rotation has no equivalent cadence for them.
