import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { SettingsView } from './SettingsView';

export default async function SettingsPage() {
  const session = await getSession();
  const db = getDb();
  const users = session?.role === 'admin'
    ? db.prepare('SELECT id, username, display_name, role, is_active, created_at FROM users ORDER BY id').all()
    : [];
  return <SettingsView currentUser={session} users={users as any[]} />;
}
