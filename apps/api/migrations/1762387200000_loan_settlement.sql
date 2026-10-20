-- Up Migration
-- تسوية السلفة مبكراً: السداد النقدي يُسجَّل على السلفة (المبلغ والمرجع والملاحظة والوقت)
-- Early loan settlement: a cash payoff is recorded on the loan (amount, reference, note, time)
alter table loans
  add column settlement_mode text check (settlement_mode in ('cash')),
  add column settlement_amount numeric(18, 4) check (settlement_amount >= 0),
  add column settlement_reference text check (length(settlement_reference) <= 120),
  add column settlement_note text check (length(settlement_note) <= 300),
  add column settled_at timestamptz;

-- Down Migration
alter table loans
  drop column settlement_mode,
  drop column settlement_amount,
  drop column settlement_reference,
  drop column settlement_note,
  drop column settled_at;
