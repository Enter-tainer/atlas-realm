CREATE TABLE IF NOT EXISTS oauth_device_flows (
  flow_id TEXT PRIMARY KEY,
  device_code TEXT NOT NULL,
  user_code TEXT NOT NULL,
  verification_uri TEXT NOT NULL,
  verification_uri_complete TEXT,
  token_name TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_poll_at INTEGER,
  completed_at INTEGER,
  access_token_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'denied', 'expired')),
  FOREIGN KEY (access_token_id) REFERENCES access_tokens(token_id)
);

CREATE INDEX IF NOT EXISTS oauth_device_flows_expiry_idx ON oauth_device_flows(expires_at);
