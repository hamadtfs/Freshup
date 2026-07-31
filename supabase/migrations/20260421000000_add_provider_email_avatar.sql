-- Add email and avatar_url columns to provider_details table
-- This allows providers to have email and avatar like customers do

ALTER TABLE public.provider_details 
ADD COLUMN IF NOT EXISTS email text,
ADD COLUMN IF NOT EXISTS avatar_url text;

-- Add comments for documentation
COMMENT ON COLUMN public.provider_details.email IS 'Provider contact email address';
COMMENT ON COLUMN public.provider_details.avatar_url IS 'Provider avatar image URL (data URL or HTTP URL)';
