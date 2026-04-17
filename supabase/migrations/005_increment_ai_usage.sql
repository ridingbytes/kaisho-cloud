-- Atomic increment function for AI usage counters.
-- Avoids the read-then-write race condition when
-- concurrent requests update the same row.

CREATE OR REPLACE FUNCTION increment_ai_usage(
    p_user_id UUID,
    p_month   TEXT,
    p_input   BIGINT,
    p_output  BIGINT
) RETURNS VOID AS $$
BEGIN
    INSERT INTO ai_usage (
        user_id, month,
        input_tokens, output_tokens,
        request_count, updated_at
    ) VALUES (
        p_user_id, p_month,
        p_input, p_output,
        1, now()
    )
    ON CONFLICT (user_id, month) DO UPDATE SET
        input_tokens  = ai_usage.input_tokens + p_input,
        output_tokens = ai_usage.output_tokens + p_output,
        request_count = ai_usage.request_count + 1,
        updated_at    = now();
END;
$$ LANGUAGE plpgsql;
