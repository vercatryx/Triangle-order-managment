-- Create a function to safely append to client order history
-- This prevents race conditions and avoids fetching/sending the whole array
CREATE OR REPLACE FUNCTION append_client_order_history(
    p_client_id TEXT,
    p_new_entry JSONB,
    p_max_entries INT DEFAULT 50
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE clients
    SET order_history = (
        SELECT jsonb_agg(elem)
        FROM (
            SELECT p_new_entry AS elem
            UNION ALL
            SELECT elem
            FROM jsonb_array_elements(COALESCE(order_history, '[]'::jsonb)) AS elem
            LIMIT p_max_entries
        ) sub
    )
    WHERE id = p_client_id;
END;
$$;
