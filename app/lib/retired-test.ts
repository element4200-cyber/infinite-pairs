// Owner-requested retirement of the single production smoke-test coin.
// Keep its receipt and immutable artwork intact; it is no longer a public group.
// Exact IDs prevent this maintenance from affecting future tokens named TEST.
export const retiredTest = {
  group: '61e6fbd6-9645-4b36-9449-bbfedce5274f',
  launch: '1f17498d-84ff-4b72-b17b-3e61d5e931c5',
  mint: '4UsWndN2S53LWU35TLESnaNW6PmKuPdk2GvCUSRQXyzW',
};
export async function archiveRetiredTest(database: D1Database) {
  await database.batch([
    database.prepare("UPDATE triple_groups SET status='archived',sequence=NULL WHERE id=? AND mint=? AND status='live' AND NOT EXISTS(SELECT 1 FROM triple_launches WHERE group_id=? AND slot>0 AND (status='finalized' OR active=1))")
      .bind(retiredTest.group,retiredTest.mint,retiredTest.group),
    database.prepare("UPDATE triple_launches SET status='archived',sequence=NULL WHERE id=? AND mint=? AND group_id=? AND slot=0 AND status='finalized' AND active IS NULL AND EXISTS(SELECT 1 FROM triple_groups WHERE id=? AND status='archived')")
      .bind(retiredTest.launch,retiredTest.mint,retiredTest.group,retiredTest.group),
  ]);
}
