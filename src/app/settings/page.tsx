export const dynamic = "force-dynamic";
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { SettingsView } from './SettingsView';

export default async function SettingsPage() {
  const session = await getSession();
  const db = getDb();
  const users = session?.role === 'admin'
    ? db.prepare('SELECT id, username, display_name, role, team_id, is_active, must_change_password, created_at FROM users ORDER BY id').all()
    : [];
  const teams = session?.role === 'admin'
    ? db.prepare(`SELECT t.id, t.team_name, t.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.team_id = t.id) AS user_count,
        (SELECT COUNT(*) FROM assets a WHERE a.team_id = t.id) AS asset_count
        FROM teams t ORDER BY t.team_name`).all()
    : [];
  return <SettingsView currentUser={session} users={users as any[]} teams={teams as any[]} />;
}
