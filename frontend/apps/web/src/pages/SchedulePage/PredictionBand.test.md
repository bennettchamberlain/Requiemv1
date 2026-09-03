# PredictionBand tests

These tests keep the restored audit surface honest: resolved HBPE bins and status metadata reach `ForecastStrip` unchanged, the full Forecast link follows its feature gate, and loading or unavailable responses remain visibly distinguishable from a removed component.

The strip itself is mocked here because its bucket geometry and tooltip behavior are independent component responsibilities; this suite verifies the Calendar-facing boundary.
