/** SQLite DDL for AutoDayTrader desktop (Better Auth + product tables). */

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  country TEXT,
  investmentGoals TEXT,
  riskTolerance TEXT,
  preferredIndustry TEXT
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  expiresAt TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt TEXT,
  refreshTokenExpiresAt TEXT,
  scope TEXT,
  password TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId TEXT NOT NULL,
  symbol TEXT NOT NULL,
  company TEXT NOT NULL,
  addedAt TEXT NOT NULL,
  UNIQUE(userId, symbol)
);

CREATE TABLE IF NOT EXISTS price_forecast (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  asOf TEXT NOT NULL,
  horizon TEXT NOT NULL,
  modelVersion TEXT NOT NULL,
  lastClose REAL NOT NULL,
  yHat REAL NOT NULL,
  lo80 REAL NOT NULL,
  hi80 REAL NOT NULL,
  direction TEXT NOT NULL,
  confidence REAL NOT NULL,
  rationale TEXT,
  evidenceUrls TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  actualClose REAL,
  absError REAL,
  pctError REAL,
  signedError REAL,
  directionHit INTEGER,
  inside80 INTEGER,
  evalRunId TEXT,
  createdAt TEXT NOT NULL,
  UNIQUE(symbol, asOf, horizon, modelVersion)
);

CREATE TABLE IF NOT EXISTS feature_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  asOf TEXT NOT NULL,
  payload TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  UNIQUE(symbol, asOf)
);

CREATE TABLE IF NOT EXISTS model_weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  promotedFrom TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eval_run (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  modelVersion TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  holdoutAsOfs TEXT,
  rowCount INTEGER DEFAULT 0,
  error TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS factor_attribution (
  id TEXT PRIMARY KEY,
  evalRunId TEXT,
  modelVersion TEXT NOT NULL,
  narrative TEXT,
  channelSummary TEXT,
  factors TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_document (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  symbol TEXT,
  title TEXT,
  source TEXT,
  sourceKind TEXT,
  excerpt TEXT,
  body TEXT,
  publishedAt TEXT,
  fetchedAt TEXT,
  domain TEXT,
  score REAL,
  tags TEXT
);

CREATE TABLE IF NOT EXISTS insider_filing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  filingDate TEXT NOT NULL,
  tradeDate TEXT NOT NULL,
  insiderName TEXT NOT NULL,
  title TEXT,
  tradeType TEXT,
  price REAL,
  qty REAL,
  valueUsd REAL,
  ownedAfter REAL,
  sourceUrl TEXT,
  raw TEXT,
  UNIQUE(ticker, filingDate, insiderName, tradeDate, qty, valueUsd)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT,
  ok INTEGER NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notify_pref (
  type TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  channels TEXT NOT NULL DEFAULT '["macos"]',
  threshold REAL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  symbol TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON login_attempts(email, createdAt);
CREATE INDEX IF NOT EXISTS idx_forecast_symbol ON price_forecast(symbol, asOf);
CREATE INDEX IF NOT EXISTS idx_insider_ticker ON insider_filing(ticker, tradeDate);
CREATE INDEX IF NOT EXISTS idx_alert_event_type ON alert_event(type, createdAt);
`;
