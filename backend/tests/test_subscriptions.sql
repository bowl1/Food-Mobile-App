\set ON_ERROR_STOP on
\ir sql/setup.sql
set role service_role;
do $$
declare owner uuid:='00000000-0000-0000-0000-000000000001'; other uuid:='00000000-0000-0000-0000-000000000002';
 j uuid; result jsonb; observed timestamptz:=now();
begin
 for i in 1..3 loop
  j:=gen_random_uuid();
  result:=reserve_free_ai_job(owner,j,'generate','trial',.001,99,1000,3);
  if result->>'state'<>'reserved' then raise exception 'free trial failed'; end if;
  update ai_jobs set status='complete',result='{}' where user_id=owner and id=j;
 end loop;
 perform sync_ai_subscription(owner,observed,'apple-period-one','fridgeout_pro_monthly',now()-interval '1 day',now()+interval '29 days',20);
 for i in 1..20 loop
  j:=gen_random_uuid();
  result:=reserve_free_ai_job(owner,j,'generate','paid',.001,99,1000,3);
  if result->>'state'<>'reserved' then raise exception 'paid use failed % %',i,result; end if;
  update ai_jobs set status='complete',result='{}' where user_id=owner and id=j;
 end loop;
 if reserve_free_ai_job(owner,gen_random_uuid(),'generate','over',.001,99,1000,3)->>'state'<>'free_limit' then
  raise exception 'more than twenty monthly uses'; end if;
 perform sync_ai_subscription(owner,observed+interval '1 second','apple-period-one','fridgeout_pro_monthly',now()-interval '1 day',now()+interval '29 days',20);
 if (free_trial_status(owner,3)->>'monthly_remaining')::integer<>0 then raise exception 'restore reset quota'; end if;
 begin
  perform sync_ai_subscription(other,observed+interval '1 second','apple-period-one','fridgeout_pro_monthly',now()-interval '1 day',now()+interval '29 days',20);
  raise exception 'foreign receipt accepted';
 exception when raise_exception then
  if sqlerrm='foreign receipt accepted' then raise; end if;
 end;
 perform sync_ai_subscription(owner,observed+interval '2 seconds','apple-period-two','fridgeout_pro_monthly',now(),now()+interval '30 days',20);
 if (free_trial_status(owner,3)->>'monthly_remaining')::integer<>20 then raise exception 'renewal did not refill'; end if;
 perform sync_ai_subscription(owner,observed+interval '1 second',null,null,null,null,20);
 if not (free_trial_status(owner,3)->>'subscribed')::boolean then raise exception 'stale event revoked renewal'; end if;
 perform sync_ai_subscription(owner,observed+interval '3 seconds',null,null,null,null,20);
 if (free_trial_status(owner,3)->>'subscribed')::boolean then raise exception 'refund did not revoke'; end if;
 if reserve_free_ai_job(owner,gen_random_uuid(),'generate','revoked',.001,99,1000,3)->>'state'<>'free_limit' then raise exception 'revoked access'; end if;
end $$;
reset role;
set role authenticated;
do $$ begin
 begin
  insert into ai_subscription_periods(user_id,store_transaction_id,product_id,starts_at,ends_at,allowance)
  values(auth.uid(),'forged','forged',now(),now()+interval '1 month',999);
  raise exception 'client granted subscription';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
