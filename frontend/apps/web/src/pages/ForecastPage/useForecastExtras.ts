import { gql, useQuery } from '@apollo/client';

const GET_FORECAST_EXTRAS = gql`
  query GetForecastExtras {
    metricForecast(days: 3) {
      metric
      status
      coverage
      horizonDays
      points {
        date
        q10
        q50
        q90
      }
    }
    placeForecast(k: 5) {
      lat
      lng
      visits
      share
    }
    predictionCalibration(limit: 14) {
      basis
      latest {
        l0Top1Acc
        ece
        driftFlag
      }
    }
    forecastHistory(days: 5) {
      date
      buckets {
        bucketIndex
        predictedL0 {
          label
          probability
        }
        actualL0
      }
    }
  }
`;

export function useForecastExtras() {
  const { data, loading } = useQuery(GET_FORECAST_EXTRAS, { errorPolicy: 'all' });

  return {
    loading,
    metrics: data?.metricForecast ?? [],
    places: data?.placeForecast ?? [],
    calibration: data?.predictionCalibration ?? null,
    historyDays: data?.forecastHistory ?? [],
  };
}
