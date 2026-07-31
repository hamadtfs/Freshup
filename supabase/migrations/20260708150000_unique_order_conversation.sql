-- One order conversation per order.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_order_conversation_per_order
  ON public.conversations (order_id)
  WHERE conversation_type = 'order' AND order_id IS NOT NULL;

-- Collapse duplicate order conversations if any already exist.
WITH ranked AS (
  SELECT
    id,
    order_id,
    ROW_NUMBER() OVER (
      PARTITION BY order_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.conversations
  WHERE conversation_type = 'order'
    AND order_id IS NOT NULL
),
dupes AS (
  SELECT id FROM ranked WHERE rn > 1
)
DELETE FROM public.conversations c
USING dupes d
WHERE c.id = d.id;
