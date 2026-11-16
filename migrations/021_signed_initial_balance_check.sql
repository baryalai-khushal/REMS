ALTER TABLE rems_settlement_participants
  DROP CHECK rems_initial_balance_equation,
  ADD CONSTRAINT rems_initial_balance_signed_equation CHECK (
    initial_minor = CAST(spending_minor AS DECIMAL(41,0)) - CAST(share_minor AS DECIMAL(41,0))
  )
