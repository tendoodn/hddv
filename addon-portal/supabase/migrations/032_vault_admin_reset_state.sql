-- Admin-initiated credential vault reset generation.
-- Server never receives nor stores GDT passwords or the local AES-GCM passphrase.
-- A reset tells the browser to discard old encrypted local data; cannot decrypt it.
CREATE TABLE IF NOT EXISTS public.addon_vault_reset_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.addon_vault_reset_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.addon_vault_reset_state FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.addon_my_vault_reset_state()
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=public,auth
AS $$
  SELECT CASE WHEN (SELECT auth.uid()) IS NULL THEN NULL
    ELSE COALESCE(
      (SELECT generation FROM public.addon_vault_reset_state WHERE user_id=(SELECT auth.uid())),0)
  END;
$$;
REVOKE ALL ON FUNCTION public.addon_my_vault_reset_state() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.addon_my_vault_reset_state() TO authenticated;

CREATE OR REPLACE FUNCTION public.addon_admin_reset_vault(p_user_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,auth
AS $$
DECLARE new_generation bigint;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.addon_is_admin() THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;
  INSERT INTO public.addon_vault_reset_state(user_id,generation,updated_at)
    VALUES (p_user_id,1,now())
  ON CONFLICT (user_id) DO UPDATE
    SET generation=public.addon_vault_reset_state.generation+1,updated_at=now()
  RETURNING generation INTO new_generation;
  INSERT INTO public.addon_audit_logs(actor_id,target_user_id,action,details)
    VALUES(auth.uid(),p_user_id,'vault_reset_requested',
      jsonb_build_object('generation',new_generation,
        'note','Reset notification only. Local AES-GCM passwords cannot be decrypted/recovered.'));
  RETURN new_generation;
END;
$$;
REVOKE ALL ON FUNCTION public.addon_admin_reset_vault(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.addon_admin_reset_vault(uuid) TO authenticated;