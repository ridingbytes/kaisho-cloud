-- Atomic token-pack credit.
--
-- The Stripe handler previously did three separate writes
-- (INSERT token_packs, SELECT bonus_tokens_remaining,
-- UPDATE users). Two races lived there:
--
--   1. Concurrent purchases for the same user read the
--      same base balance and the second UPDATE clobbered
--      the first, losing a pack's tokens.
--   2. If the INSERT succeeded but the UPDATE failed and
--      Stripe redelivered, the retry hit the token_packs
--      UNIQUE, skipped as "already processed", and never
--      ran the bump — crediting the ledger but not the
--      balance.
--
-- credit_token_pack does the ledger insert and the
-- balance bump in one statement-pair inside a single
-- function invocation (one transaction). The insert uses
-- ON CONFLICT DO NOTHING; the bump only runs when a row
-- was actually inserted. Returns the new balance, or NULL
-- when the charge was already credited (idempotent
-- redelivery).

CREATE OR REPLACE FUNCTION credit_token_pack(
    p_user_id   UUID,
    p_charge_id TEXT,
    p_price_id  TEXT,
    p_tokens    BIGINT
) RETURNS BIGINT AS $$
DECLARE
    v_new BIGINT;
BEGIN
    INSERT INTO token_packs (
        user_id, tokens, stripe_charge_id, stripe_price_id
    ) VALUES (
        p_user_id, p_tokens, p_charge_id, p_price_id
    )
    ON CONFLICT (stripe_charge_id) DO NOTHING;

    -- No row inserted → this charge was already credited.
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    UPDATE users
    SET bonus_tokens_remaining =
        bonus_tokens_remaining + p_tokens
    WHERE id = p_user_id
    RETURNING bonus_tokens_remaining INTO v_new;

    RETURN v_new;
END;
$$ LANGUAGE plpgsql;
