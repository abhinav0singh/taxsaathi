# Seeding TaxExplainers

CloudFormation/SAM creates the *table*, not the *rows* — that's a deliberate
IaC boundary, not a gap: infra-as-code manages infrastructure, not data.
Run these once, after `sam deploy` succeeds.

Run each of these from the repo root (where seed-data.json lives). Each
is a separate `put-item` call rather than one batch call, so if one fails
you know exactly which item and why, and can `get-item` it back immediately.

```powershell
aws dynamodb put-item --table-name TaxExplainers --item file://seed-item-80c.json
aws dynamodb put-item --table-name TaxExplainers --item file://seed-item-80d.json
aws dynamodb put-item --table-name TaxExplainers --item file://seed-item-87a.json
aws dynamodb put-item --table-name TaxExplainers --item file://seed-item-overview.json
```

(Each seed-item-*.json is just that one entry's value from seed-data.json,
as its own file — `put-item --item` needs a single item's JSON, not the
wrapper object with all four.)

Verify each landed correctly:

```powershell
aws dynamodb get-item --table-name TaxExplainers --key '{"topic": {"S": "80C"}}'
```

Repeat for `"80D"`, `"87A_rebate"`, `"new_vs_old_regime"`. You should get
back the full item (topic + explanation + keywords) for each — that's your
proof this stage's first TEST_PLAN.md section 4 checkbox actually passes,
not just that the `put-item` command exited without an error.
