/**
 * Product flags for prediction-first OpenStock.
 * Trading chrome stays in the repo but is off by default.
 */

/** When false, sidebar/tabs show Forecasts; /bot redirects to /forecasts. */
export const tradingUiEnabled =
  process.env.TRADING_UI_ENABLED === 'true' || process.env.NEXT_PUBLIC_TRADING_UI_ENABLED === 'true';

export const FORECAST_ACTIVE_POINTER = 'swing-baseline-active';
