
-- Allow each signed-in user to read only their own trial claim status.
-- The claim itself remains writable only through addon_claim_trial().
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='addon_trial_claims'
      AND policyname='trial claim self read'
  ) THEN
    CREATE POLICY "trial claim self read"
      ON public.addon_trial_claims
      FOR SELECT TO authenticated
      USING (user_id = auth.uid());
  END IF;
END;
$$;

-- Tendoo Add-on admin RPCs
-- Run in Supabase SQL Editor as project owner.

CREATE OR REPLACE FUNCTION public.addon_admin_list_users(p_search text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.addon_is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT u.id AS user_id, u.email,
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id, 'plan_code', s.plan_code, 'status', s.status,
        'source', s.source, 'starts_at', s.starts_at, 'ends_at', s.ends_at,
        'created_at', s.created_at
      ) ORDER BY s.created_at DESC) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb) AS subscriptions,
      MAX(s.ends_at) FILTER (WHERE s.status='active' AND s.ends_at > now()) AS latest_active_until,
      bool_or(s.status='active' AND s.starts_at <= now() AND s.ends_at > now()) AS active_now
    FROM auth.users u
    LEFT JOIN public.addon_subscriptions s ON s.user_id=u.id
    WHERE COALESCE(p_search,'')='' OR u.email ILIKE '%'||p_search||'%'
    GROUP BY u.id,u.email
    ORDER BY MAX(s.created_at) DESC NULLS LAST, u.created_at DESC
    LIMIT 500
  ) x;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.addon_admin_revoke(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.addon_is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_user_id) THEN RAISE EXCEPTION 'user_not_found'; END IF;
  UPDATE public.addon_subscriptions
    SET status='revoked'
    WHERE user_id=p_user_id AND status='active' AND ends_at > now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO public.addon_audit_logs(actor_id,target_user_id,action,details)
  VALUES(auth.uid(),p_user_id,'subscriptions_revoked',jsonb_build_object('rows',v_count));
  RETURN jsonb_build_object('success',true,'revoked_count',v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.addon_admin_list_logs(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.addon_is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_result
  FROM (
    SELECT l.id,l.action,l.details,l.created_at,
      a.email AS actor_email,t.email AS target_email
    FROM public.addon_audit_logs l
    LEFT JOIN auth.users a ON a.id=l.actor_id
    LEFT JOIN auth.users t ON t.id=l.target_user_id
    ORDER BY l.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),500)
  ) x;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.addon_admin_list_users(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.addon_admin_revoke(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.addon_admin_list_logs(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.addon_admin_list_users(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.addon_admin_revoke(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.addon_admin_list_logs(integer) TO authenticated;
