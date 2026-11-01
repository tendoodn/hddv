-- Admin subscription history: readable plan names and SePay transaction identifiers.
-- Apply once in the Tendoo Add-on Supabase SQL Editor.

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
    SELECT
      u.id AS user_id,
      u.email,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', s.id,
            'plan_code', s.plan_code,
            'plan_name', p.name,
            'status', s.status,
            'source', s.source,
            'starts_at', s.starts_at,
            'ends_at', s.ends_at,
            'created_at', s.created_at,
            'provider_event_id', pay.provider_event_id,
            'bank_reference', pay.bank_reference,
            'payment_reference', pay.payment_reference
          ) ORDER BY s.created_at DESC
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'::jsonb
      ) AS subscriptions,
      MAX(s.ends_at) FILTER (
        WHERE s.status = 'active' AND s.ends_at > pg_catalog.now()
      ) AS latest_active_until,
      COALESCE(
        bool_or(
          s.status = 'active'
          AND s.starts_at <= pg_catalog.now()
          AND s.ends_at > pg_catalog.now()
        ),
        false
      ) AS active_now
    FROM auth.users u
    LEFT JOIN public.addon_subscriptions s ON s.user_id = u.id
    LEFT JOIN public.addon_plans p ON p.code = s.plan_code
    LEFT JOIN LATERAL (
      SELECT
        pe.provider_event_id,
        pe.payload ->> 'referenceCode' AS bank_reference,
        o.payment_reference
      FROM public.addon_orders o
      LEFT JOIN public.addon_payment_events pe
        ON pe.order_id = o.id AND pe.provider = 'sepay'
      WHERE o.id = s.order_id
      ORDER BY pe.created_at DESC NULLS LAST
      LIMIT 1
    ) pay ON true
    WHERE COALESCE(p_search, '') = ''
       OR u.email ILIKE '%' || p_search || '%'
    GROUP BY u.id, u.email
    ORDER BY MAX(s.created_at) DESC NULLS LAST, u.created_at DESC
    LIMIT 500
  ) x;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.addon_admin_list_users(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.addon_admin_list_users(text) TO authenticated;
