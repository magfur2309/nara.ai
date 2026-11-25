import type { RowDataPacket } from 'mysql2/promise';
import type {
  ErpAccessEvaluationMode,
  ErpPurchasingMenuPermissions,
  ErpUserAccessEntry,
  ErpUsersAccessResponse,
} from '../src/config/pendingTransactionRules.ts';
import {
  fetchErpBridgeJson,
  getErpBridgeConfig,
  isErpMysqlConfigured,
  withReadOnlyConnection,
} from './erpMysql.ts';

/**
 * Verified myerpplus Purchasing transaction menu IDs (m0_menu / m0_role_menu, rmmoduleid = 4):
 * - 3  : Permintaan Pembelian (PR)   -> m4_TransaksiPR.swf
 * - 7  : Order Pembelian (PO)        -> m4_TransaksiPO.swf
 * - 10 : Penerimaan Barang (GRN)     -> m4_TransaksiGRN.swf
 * - 11 : Invoice Pembelian (PI / RI) -> m4_TransaksiRI.swf
 * - 15 : Pembayaran Hutang (VP)      -> m4_TransaksiVP.swf
 */
const PURCHASING_MODULE_ID = 4;
const MENU_ID_TO_KEY: Record<number, keyof ErpPurchasingMenuPermissions> = {
  3: 'pr',
  7: 'po',
  10: 'grn',
  11: 'pi',
  15: 'vp',
};

const USER_ACCESS_CACHE_TTL_MS = 60_000;
let cachedUsersAccess: { expiresAt: number; data: ErpUsersAccessResponse } | null = null;

export function invalidateErpUserAccessCache(): void {
  cachedUsersAccess = null;
}

function emptyPurchasingAccess(): ErpPurchasingMenuPermissions {
  return { pr: false, po: false, grn: false, pi: false, vp: false };
}

function hasActiveBitstringAccess(rawAkses: unknown): boolean {
  const s = String(rawAkses ?? '').trim();
  return s.length > 0 && s.includes('1');
}

function normalizeRoleKey(role: string): string {
  return role.trim().toLowerCase();
}

/**
 * Purely READ-ONLY lookup of active ERP users (`m0_user`, NEVER selecting `upassword`)
 * and their Purchasing menu permissions (`m0_user_role`/`m0_user_role_s` -> `m0_role_menu`/`m0_role_menu_s`,
 * plus `m0_usergrupmenu` fallback).
 */
export async function queryErpUsersPurchasingAccess(opts?: {
  bypassCache?: boolean;
}): Promise<ErpUsersAccessResponse> {
  if (!opts?.bypassCache && cachedUsersAccess && Date.now() < cachedUsersAccess.expiresAt) {
    return cachedUsersAccess.data;
  }

  if (!isErpMysqlConfigured()) {
    return {
      available: false,
      sourceMode: 'unavailable',
      users: [],
      fetchedAt: new Date().toISOString(),
      warning: 'Koneksi MySQL ERP belum dikonfigurasi.',
    };
  }

  const bridgeCfg = getErpBridgeConfig();
  if (bridgeCfg.configured) {
    try {
      const bridgeRes = await fetchErpBridgeJson<{
        bridgeVersion?: number;
        users?: ErpUserAccessEntry[];
        fetchedAt?: string;
        warning?: string;
      }>('/users-access');

      const users: ErpUserAccessEntry[] = Array.isArray(bridgeRes.users)
        ? bridgeRes.users.map((u) => ({
            erpUserId: Number(u.erpUserId || 0),
            erpUserCode: String(u.erpUserCode || '').trim(),
            erpUserName: String(u.erpUserName || '').trim(),
            level: Number(u.level || 0),
            groupId: Number(u.groupId || 0),
            roles: Array.isArray(u.roles) ? u.roles.map((r) => String(r || '').trim()).filter(Boolean) : [],
            purchasingAccess: {
              pr: Boolean(u.purchasingAccess?.pr),
              po: Boolean(u.purchasingAccess?.po),
              grn: Boolean(u.purchasingAccess?.grn),
              pi: Boolean(u.purchasingAccess?.pi),
              vp: Boolean(u.purchasingAccess?.vp),
            },
          }))
        : [];

      const data: ErpUsersAccessResponse = {
        available: true,
        sourceMode: 'bridge_v9',
        users,
        fetchedAt: bridgeRes.fetchedAt || new Date().toISOString(),
        warning: bridgeRes.warning,
      };
      cachedUsersAccess = { expiresAt: Date.now() + USER_ACCESS_CACHE_TTL_MS, data };
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/404|Endpoint tidak ditemukan|\/users-access/i.test(msg)) {
        const data: ErpUsersAccessResponse = {
          available: false,
          sourceMode: 'bridge_upgrade_required',
          users: [],
          fetchedAt: new Date().toISOString(),
          warning:
            'Skrip erp-mysql-bridge.mjs lokal belum mendukung endpoint /users-access (v9). Unduh & jalankan Bridge v9 agar hak akses menu ERP (m0_user & m0_role_menu) terbaca otomatis.',
        };
        cachedUsersAccess = { expiresAt: Date.now() + 15_000, data };
        return data;
      }
      throw err;
    }
  }

  // Direct read-only MySQL lookup
  const data = await withReadOnlyConnection(async (conn): Promise<ErpUsersAccessResponse> => {
    const [tblRows] = await conn.query<RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN (
           'm0_user', 'm0_user_role', 'm0_user_role_s',
           'm0_role_menu', 'm0_role_menu_s', 'm0_usergrupmenu'
         )`
    );
    const tblSet = new Set(
      tblRows.map((r) => String(r.TABLE_NAME || r.table_name || '').toLowerCase())
    );

    if (!tblSet.has('m0_user')) {
      return {
        available: false,
        sourceMode: 'mysql_direct',
        users: [],
        fetchedAt: new Date().toISOString(),
        warning: 'Tabel m0_user tidak ditemukan di database ERP.',
      };
    }

    // NEVER select upassword
    const [userRows] = await conn.query<RowDataPacket[]>(
      `SELECT userid, ukode, unama, COALESCE(ulevel, 0) AS ulevel, COALESCE(ugrup, 0) AS ugrup
       FROM m0_user
       WHERE COALESCE(uaktif, 1) = 1
       ORDER BY unama ASC, ukode ASC`
    );

    // Map userid -> role names (from m0_user_role and m0_user_role_s)
    const userRolesMap = new Map<number, Set<string>>();
    const addUserRole = (uid: number, role: string) => {
      const clean = role.trim();
      if (!uid || !clean) return;
      const set = userRolesMap.get(uid) || new Set<string>();
      set.add(clean);
      userRolesMap.set(uid, set);
    };

    if (tblSet.has('m0_user_role')) {
      try {
        const [rRows] = await conn.query<RowDataPacket[]>(
          `SELECT userid, role FROM m0_user_role WHERE role IS NOT NULL AND TRIM(role) <> ''`
        );
        for (const r of rRows) {
          addUserRole(Number(r.userid || 0), String(r.role || ''));
        }
      } catch (err) {
        console.warn('[ErpUserAccess] m0_user_role read warning:', err instanceof Error ? err.message : err);
      }
    }

    if (tblSet.has('m0_user_role_s')) {
      try {
        const [rsRows] = await conn.query<RowDataPacket[]>(
          `SELECT userid, role FROM m0_user_role_s WHERE role IS NOT NULL AND TRIM(role) <> ''`
        );
        for (const r of rsRows) {
          addUserRole(Number(r.userid || 0), String(r.role || ''));
        }
      } catch (err) {
        console.warn('[ErpUserAccess] m0_user_role_s read warning:', err instanceof Error ? err.message : err);
      }
    }

    // Map normalized role -> Purchasing menu access flags (rmmoduleid = 4, rmmenuid IN 3,7,10,11,15)
    const roleMenuMap = new Map<string, ErpPurchasingMenuPermissions>();
    const grantRoleMenu = (roleName: string, menuId: number, rawAkses: unknown) => {
      const key = MENU_ID_TO_KEY[menuId];
      if (!key || !hasActiveBitstringAccess(rawAkses)) return;
      const norm = normalizeRoleKey(roleName);
      if (!norm) return;
      const perms = roleMenuMap.get(norm) || emptyPurchasingAccess();
      perms[key] = true;
      roleMenuMap.set(norm, perms);
    };

    if (tblSet.has('m0_role_menu')) {
      try {
        const [rmRows] = await conn.query<RowDataPacket[]>(
          `SELECT rmrole, rmmenuid, rmakses
           FROM m0_role_menu
           WHERE rmmoduleid = ? AND rmmenuid IN (3, 7, 10, 11, 15)`,
          [PURCHASING_MODULE_ID]
        );
        for (const r of rmRows) {
          grantRoleMenu(String(r.rmrole || ''), Number(r.rmmenuid || 0), r.rmakses);
        }
      } catch (err) {
        console.warn('[ErpUserAccess] m0_role_menu read warning:', err instanceof Error ? err.message : err);
      }
    }

    if (tblSet.has('m0_role_menu_s')) {
      try {
        const [rmsRows] = await conn.query<RowDataPacket[]>(
          `SELECT rmrole, rmmenuid, rmakses
           FROM m0_role_menu_s
           WHERE rmmoduleid = ? AND rmmenuid IN (3, 7, 10, 11, 15)`,
          [PURCHASING_MODULE_ID]
        );
        for (const r of rmsRows) {
          grantRoleMenu(String(r.rmrole || ''), Number(r.rmmenuid || 0), r.rmakses);
        }
      } catch (err) {
        console.warn('[ErpUserAccess] m0_role_menu_s read warning:', err instanceof Error ? err.message : err);
      }
    }

    // Optional group-menu fallback (m0_usergrupmenu)
    const groupMenuMap = new Map<number, ErpPurchasingMenuPermissions>();
    if (tblSet.has('m0_usergrupmenu')) {
      try {
        const [gmRows] = await conn.query<RowDataPacket[]>(
          `SELECT ugmusergrup, ugmmenuid, ugmakses
           FROM m0_usergrupmenu
           WHERE ugmmoduleid = ? AND ugmmenuid IN (3, 7, 10, 11, 15)`,
          [PURCHASING_MODULE_ID]
        );
        for (const r of gmRows) {
          const grpId = Number(r.ugmusergrup || 0);
          const key = MENU_ID_TO_KEY[Number(r.ugmmenuid || 0)];
          if (!grpId || !key || !hasActiveBitstringAccess(r.ugmakses)) continue;
          const perms = groupMenuMap.get(grpId) || emptyPurchasingAccess();
          perms[key] = true;
          groupMenuMap.set(grpId, perms);
        }
      } catch (err) {
        console.warn('[ErpUserAccess] m0_usergrupmenu read warning:', err instanceof Error ? err.message : err);
      }
    }

    const users: ErpUserAccessEntry[] = userRows.map((u) => {
      const erpUserId = Number(u.userid || 0);
      const erpUserCode = String(u.ukode || '').trim();
      const erpUserName = String(u.unama || erpUserCode || `User #${erpUserId}`).trim();
      const level = Number(u.ulevel || 0);
      const groupId = Number(u.ugrup || 0);
      const roles = Array.from(userRolesMap.get(erpUserId) || []).sort((a, b) => a.localeCompare(b));

      const purchasingAccess = emptyPurchasingAccess();
      for (const roleName of roles) {
        const rp = roleMenuMap.get(normalizeRoleKey(roleName));
        if (rp) {
          if (rp.pr) purchasingAccess.pr = true;
          if (rp.po) purchasingAccess.po = true;
          if (rp.grn) purchasingAccess.grn = true;
          if (rp.pi) purchasingAccess.pi = true;
          if (rp.vp) purchasingAccess.vp = true;
        }
      }

      // Apply group-menu fallback ONLY when user has no explicit role entries
      if (roles.length === 0 && groupId > 0) {
        const gp = groupMenuMap.get(groupId);
        if (gp) {
          if (gp.pr) purchasingAccess.pr = true;
          if (gp.po) purchasingAccess.po = true;
          if (gp.grn) purchasingAccess.grn = true;
          if (gp.pi) purchasingAccess.pi = true;
          if (gp.vp) purchasingAccess.vp = true;
        }
      }

      return {
        erpUserId,
        erpUserCode,
        erpUserName,
        level,
        groupId,
        roles,
        purchasingAccess,
      };
    });

    return {
      available: true,
      sourceMode: 'mysql_direct',
      users,
      fetchedAt: new Date().toISOString(),
    };
  });

  cachedUsersAccess = { expiresAt: Date.now() + USER_ACCESS_CACHE_TTL_MS, data };
  return data;
}

/**
 * Resolves a mapped SOP Brain user's Purchasing menu permissions from ERP.
 */
export async function resolveErpUserPurchasingAccess(params: {
  erpUserId?: number;
  erpUserCode?: string;
  bypassCache?: boolean;
}): Promise<{
  mode: ErpAccessEvaluationMode;
  entry: ErpUserAccessEntry | null;
  warning?: string;
}> {
  const targetId = Number(params.erpUserId || 0);
  const targetCode = String(params.erpUserCode || '').trim().toLowerCase();

  if (targetId <= 0 && !targetCode) {
    return { mode: 'unmapped', entry: null };
  }

  const res = await queryErpUsersPurchasingAccess({ bypassCache: params.bypassCache });
  if (!res.available) {
    return {
      mode: res.sourceMode === 'bridge_upgrade_required' ? 'bridge_upgrade_required' : 'unmapped',
      entry: null,
      warning: res.warning,
    };
  }

  const matched =
    (targetId > 0 ? res.users.find((u) => u.erpUserId === targetId) : undefined) ||
    (targetCode ? res.users.find((u) => u.erpUserCode.toLowerCase() === targetCode) : undefined) ||
    null;

  if (!matched) {
    return {
      mode: 'erp_user_not_found',
      entry: null,
      warning: `Akun ERP yang dipetakan (${params.erpUserCode || `#${targetId}`}) tidak aktif atau tidak ditemukan di m0_user.`,
    };
  }

  return {
    mode: 'erp_mapped',
    entry: matched,
  };
}
