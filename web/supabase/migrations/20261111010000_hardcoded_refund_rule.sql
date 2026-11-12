-- Decision D43: events whose policy text the reader cannot turn into a rule get a
-- hand-written rule, so releasing a seat is not blocked on the policy reader.
--
-- "No refunds within 24h." does not say what applies earlier. Hand-written reading:
-- full refund when resold more than 24 hours before the start, nothing inside 24 hours.
-- Only fills an empty rule; a rule the organiser confirms later on /manage replaces it.

update events
set refund_rule = jsonb_build_object(
      'version', 1,
      'clauses', jsonb_build_array(
        jsonb_build_object(
          'tier_id', null, 'tier_name', null, 'within_hours_of_start', null,
          'percent', 100, 'fee_cents', 0, 'quote', refund_policy_text),
        jsonb_build_object(
          'tier_id', null, 'tier_name', null, 'within_hours_of_start', 24,
          'percent', 0, 'fee_cents', 0, 'quote', refund_policy_text)
      )
    ),
    refund_rule_confirmed_at = now()
where refund_rule is null
  and refund_policy_text = 'No refunds within 24h.';
