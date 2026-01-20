-- Create a function to execute dynamic SQL (for migration scripts)
create or replace function exec_sql(sql_query text)
returns void
language plpgsql
security definer
as $$
begin
  execute sql_query;
end;
$$;
