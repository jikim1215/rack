// tests/ip-utils.test.ts — 공인 IP 판정·중복 검사(인메모리 SQLite) 단위테스트
// 정책 계약: 사설/특수 대역 중복 허용, 공인 IP만 자산 간 중복 차단 (사용자 확정 스코프)
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { isPublicIpv4, findPublicIpDuplicate } from "../src/lib/ip-utils.ts";

// ── isPublicIpv4: 대역 경계값 ──

test("공인 판정: 일반 공인 대역", () => {
  for (const ip of ["8.8.8.8", "211.45.67.89", "1.1.1.1", "172.15.0.1", "172.32.0.1", "192.167.1.1", "192.169.1.1", "9.255.255.255", "11.0.0.0"]) {
    assert.equal(isPublicIpv4(ip), true, ip);
  }
});

test("사설 판정: RFC1918 3개 대역 + 경계", () => {
  for (const ip of ["10.0.0.0", "10.255.255.255", "172.16.0.0", "172.31.255.255", "192.168.0.0", "192.168.255.255"]) {
    assert.equal(isPublicIpv4(ip), false, ip);
  }
});

test("특수 대역 판정: 루프백/링크로컬/멀티캐스트/예약", () => {
  for (const ip of ["127.0.0.1", "169.254.1.1", "224.0.0.1", "239.255.255.255", "0.0.0.0", "240.0.0.1", "255.255.255.255"]) {
    assert.equal(isPublicIpv4(ip), false, ip);
  }
});

test("형식 불량: IPv4가 아니면 false", () => {
  for (const ip of ["", "abc", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.999", "8.8.8.8/24", " 8.8.8.8x"]) {
    assert.equal(isPublicIpv4(ip), false, JSON.stringify(ip));
  }
});

test("공백 트림: 앞뒤 공백은 허용", () => {
  assert.equal(isPublicIpv4("  8.8.8.8  "), true);
});

// ── findPublicIpDuplicate: DB 중복 검사 ──

function makeDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_name TEXT NOT NULL,
      ip_address TEXT DEFAULT ''
    );
    CREATE TABLE asset_ips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      ip_address TEXT NOT NULL
    );
  `);
  return db;
}

test("대표 IP 중복: 다른 자산이 같은 공인 IP를 쓰면 검출", () => {
  const db = makeDb();
  db.prepare("INSERT INTO assets (asset_name, ip_address) VALUES ('기존장비', '211.45.67.89')").run();
  const dup = findPublicIpDuplicate(db, ["211.45.67.89"]);
  assert.ok(dup);
  assert.equal(dup.assetName, "기존장비");
  assert.equal(dup.ip, "211.45.67.89");
});

test("추가 IP(asset_ips) 중복도 검출", () => {
  const db = makeDb();
  db.prepare("INSERT INTO assets (asset_name) VALUES ('VIP보유')").run();
  db.prepare("INSERT INTO asset_ips (asset_id, ip_address) VALUES (1, '8.8.4.4')").run();
  const dup = findPublicIpDuplicate(db, ["8.8.4.4"]);
  assert.ok(dup);
  assert.equal(dup.assetId, 1);
});

test("사설 IP는 중복이어도 통과 (정책)", () => {
  const db = makeDb();
  db.prepare("INSERT INTO assets (asset_name, ip_address) VALUES ('HA-1', '172.16.101.111')").run();
  assert.equal(findPublicIpDuplicate(db, ["172.16.101.111"]), null);
});

test("excludeAssetId: 자기 자신 재저장은 중복 아님", () => {
  const db = makeDb();
  db.prepare("INSERT INTO assets (asset_name, ip_address) VALUES ('본인', '211.45.67.89')").run();
  assert.equal(findPublicIpDuplicate(db, ["211.45.67.89"], 1), null);
  assert.ok(findPublicIpDuplicate(db, ["211.45.67.89"], 2), "타 자산 기준으로는 중복");
});

test("빈 값/공백/중복 입력 정리: 검사 대상에서 제외", () => {
  const db = makeDb();
  db.prepare("INSERT INTO assets (asset_name, ip_address) VALUES ('기존', '211.45.67.89')").run();
  assert.equal(findPublicIpDuplicate(db, ["", "  ", "10.0.0.1"]), null);
  // 같은 IP를 목록에 두 번 넣어도 첫 검출만 반환
  const dup = findPublicIpDuplicate(db, ["211.45.67.89", "211.45.67.89"]);
  assert.ok(dup);
});
