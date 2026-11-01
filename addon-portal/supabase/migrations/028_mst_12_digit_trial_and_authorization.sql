-- AutoTax V3.2: accept 12-digit MST in trial and GDT authorization.
-- Preserve existing 10-digit and 13-digit branch MST identities for compatibility
-- with already active clients. The new trial UI asks for 10/12 digits.
-- Only updates the validation expression in the two existing SECURITY DEFINER
-- functions. Retains their existing signatures, search_path, business rules,
-- privilege grants and trial anti-abuse constraints.
do $mst_update$
declare
 v_name text;
 v_definition text;
 v_old constant text := '^[0-9]{10}([0-9]{3})?$';
 v_new constant text := '^[0-9]{10}([0-9]{2}|[0-9]{3})?$';
begin
 foreach v_name in array array[
  'addon_start_mst_trial(text)',
  'addon_authorize_mst(text)'
 ] loop
  v_definition := pg_get_functiondef(('public.'||v_name)::regprocedure);
  if position(v_old in v_definition)=0 then
   if position(v_new in v_definition)=0 then
    raise exception 'mst_validation_rule_not_found: %', v_name;
   end if;
  else
   execute replace(v_definition,v_old,v_new);
  end if;
 end loop;
end $mst_update$;
notify pgrst, 'reload schema';
