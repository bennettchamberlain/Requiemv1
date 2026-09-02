# PredictionBand

## Intent

`PredictionBand` restores the compact HBPE histogram that historically appeared at the top of Feed. Calendar is now the combined day surface, so the band sits above its schedule.

## Contract

- Accepts the `ForecastResponse` returned by `useForecastService('24h')` without deriving or replacing bins from calendar data.
- Delegates bin ordering, activity color, confidence opacity, tooltips, model version, pipeline progress, and generation time to the existing `ForecastStrip` component.
- Identifies the forecast as tomorrow's 96 quarter-hour bins because the HBPE `/histogram` endpoint begins at midnight tonight.
- Shows a link to the richer `/forecast` surface only when the `forecast.page` feature is enabled.

## States

- A resolved forecast renders the interactive strip.
- An initial request renders a compact loading message without covering the calendar.
- An error or swallowed-null GraphQL response renders an explicit unavailable message.

The panel uses ordinary in-flow status text rather than page-level loading overlays, keeping the schedule usable while the independent prediction request resolves or fails.
