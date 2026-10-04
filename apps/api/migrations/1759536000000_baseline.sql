-- Up Migration
-- أساس القاعدة: دالة مشتركة لتحديث updated_at وإنشاء معرّفات UUIDv7 (مدمجة في PostgreSQL 18: uuidv7()).
create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Down Migration
drop function set_updated_at();
