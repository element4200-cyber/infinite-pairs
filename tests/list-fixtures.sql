-- Synthetic localhost fixtures only. Never run against a hosted/remote database.
UPDATE launches SET status='expired',active=NULL WHERE description LIKE 'LOCAL%NEVER BROADCAST';
WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM n WHERE value<102)
INSERT INTO launches(id,auth_hash,owner,mint,name,symbol,uri,description,image,predecessor,quote_mint,quote_symbol,dev_buy,slippage,sequence,status,created_at,finalized_at,build_until)
SELECT 'local-list-'||value,'local-auth-'||value,CASE WHEN value%2=0 THEN 'local-creator-A' ELSE 'local-creator-B' END,CASE WHEN value=102 THEN '8RWY2rx2K1aeDRDNHX4DcZwohdc9V4XfR75D2zkvpump' ELSE 'local-list-mint-'||value END,'LOCAL List Fixture '||value,'LINK'||value,'https://example.invalid','LOCAL LIST TEST — NEVER BROADCAST','',NULL,'So11111111111111111111111111111111111111112','SOL','0',1,value,'finalized',1,1,1 FROM n;
