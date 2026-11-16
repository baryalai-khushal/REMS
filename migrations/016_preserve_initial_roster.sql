INSERT INTO rems_period_participants (period_key, user_id)
SELECT roster_period, user_id FROM rems_memberships
