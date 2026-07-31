-- One open support thread per user (no order_id). Prevents duplicate
-- conversations from concurrent POST /api/support/conversation calls
-- (e.g. React Strict Mode double-mount in development).

-- 1) Keep the oldest support conversation per user; remove newer duplicates.
WITH ranked AS (
  SELECT
    id,
    created_by,
    ROW_NUMBER() OVER (
      PARTITION BY created_by
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.conversations
  WHERE conversation_type = 'support'
    AND order_id IS NULL
),
dupes AS (
  SELECT id FROM ranked WHERE rn > 1
)
DELETE FROM public.conversations c
USING dupes d
WHERE c.id = d.id;

-- 2) Then enforce uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_support_conversation_per_creator
  ON public.conversations (created_by)
  WHERE conversation_type = 'support' AND order_id IS NULL;
