import { getDb } from "@/lib/db";
import ContractsView from "./ContractsView";

export default function ContractsPage() {
  const db = getDb();
  const vendors = db.prepare(`SELECT * FROM vendors WHERE is_active = 1 ORDER BY vendor_name`).all() as any[];
  const contracts = db.prepare(`
    SELECT c.*, v.vendor_name
    FROM contracts c
    LEFT JOIN vendors v ON c.vendor_id = v.id
    ORDER BY c.end_date
  `).all() as any[];

  return <ContractsView vendors={vendors} contracts={contracts} />;
}
