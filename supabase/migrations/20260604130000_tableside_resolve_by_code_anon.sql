-- Allow guest browsers to resolve /t/{code} via RPC when edge function is unavailable.

GRANT EXECUTE ON FUNCTION public.tableside_resolve_by_code(text) TO anon;
GRANT EXECUTE ON FUNCTION public.tableside_resolve_by_code(text) TO authenticated;
