begin;

-- The one-off conversion must remove the two explicitly guarded album ratings,
-- including rating 60 owned by a different user. Keep the function's internal
-- admin check and fixed targets, but allow it to cross the owner-only ratings
-- RLS policy after those guards have passed.
alter function public.admin_convert_definitely_maybe(boolean) security definer;

commit;
