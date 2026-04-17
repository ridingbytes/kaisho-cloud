-- AI usage tracking for the cloud AI gateway.
--
-- Each row aggregates token usage for a user within a
-- billing month. The gateway increments counters on
-- every request; the billing system reads them monthly.

CREATE TABLE ai_usage (
    user_id       UUID NOT NULL
                  REFERENCES users(id) ON DELETE CASCADE,
    month         TEXT NOT NULL,
    input_tokens  BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    request_count INT NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, month)
);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON ai_usage
    FOR ALL USING (false);
