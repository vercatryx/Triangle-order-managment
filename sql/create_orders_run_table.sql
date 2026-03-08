-- Stores batch results for async "create orders next week" runs.
-- When the cron hits run-async, it gets 202 immediately; batches run in the background
-- and the last batch merges batch_results and sends the report email.

CREATE TABLE IF NOT EXISTS create_orders_run (
    creation_id BIGINT PRIMARY KEY,
    batch_results JSONB NOT NULL DEFAULT '[]',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE create_orders_run IS 'Temporary storage for async create-orders-next-week batch results; last batch merges and sends report then deletes row.';
