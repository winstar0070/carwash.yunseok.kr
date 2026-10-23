CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX challenges_expiry ON challenges(expires_at);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
