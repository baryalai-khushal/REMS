import "./env";
import { db } from "../src/server/database";
async function main() {
  try {
    await db().execute("DELETE FROM rems_sessions WHERE expires_at <= CURRENT_TIMESTAMP(3)");
    await db().execute("DELETE FROM rems_login_throttle WHERE window_end <= CURRENT_TIMESTAMP(3)");
    console.log("Expired sessions and login limits removed.");
  } finally { await db().end(); }
}
main().catch(() => { console.error("Cleanup failed. Check MySQL configuration."); process.exitCode = 1; });
