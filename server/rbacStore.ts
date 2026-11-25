import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildPresetPermissionMatrix,
  createEmptyPermissionMatrix,
  createFullPermissionMatrix,
  MENU_MODULE_TABS,
  MENU_REGISTRY_TREE,
  normalizePermissionMatrix,
  type RolePermissionMatrix,
} from '../src/config/menuRegistry.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../data');
const STORE_PATH = path.join(DATA_DIR, 'rbac-store.json');

// Session signing secret: reads env var with cryptographically secure ephemeral fallback
const SESSION_SECRET =
  process.env.RBAC_SESSION_SECRET && process.env.RBAC_SESSION_SECRET.trim().length >= 16
    ? process.env.RBAC_SESSION_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export interface RbacRoleRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  isSystemAdmin: boolean;
  permissions: RolePermissionMatrix;
  createdAt: string;
  updatedAt: string;
}

export interface RbacUserRecord {
  id: string;
  username: string;
  fullName: string;
  email: string;
  roleId: string;
  divisionId?: string;
  divisionName?: string;
  passwordHash: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SafeRbacUser {
  id: string;
  username: string;
  fullName: string;
  email: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  divisionId?: string;
  divisionName?: string;
  isSystemAdmin: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RbacAuditAction =
  | 'ROLE_CREATE'
  | 'ROLE_UPDATE'
  | 'ROLE_PERMISSIONS_UPDATE'
  | 'ROLE_DELETE'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_ROLE_CHANGE'
  | 'USER_STATUS_CHANGE'
  | 'USER_PASSWORD_RESET'
  | 'USER_DELETE'
  | 'AUTH_LOGIN';

export interface RbacAuditLogEntry {
  id: string;
  actorId: string;
  actorUsername: string;
  actorName: string;
  actorRoleCode: string;
  action: RbacAuditAction;
  targetType: 'ROLE' | 'USER' | 'AUTH';
  targetId: string;
  targetLabel: string;
  detail: string;
  createdAt: string;
}

interface RbacStoreData {
  version: number;
  roles: RbacRoleRecord[];
  users: RbacUserRecord[];
  auditLogs: RbacAuditLogEntry[];
}

export interface RbacActorContext {
  id: string;
  username: string;
  fullName: string;
  roleCode: string;
}

// ===================== PASSWORD HASHING (SCRYPT + TIMING-SAFE) =====================

export function hashPassword(plainPassword: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plainPassword, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(plainPassword: string, storedHash: string): boolean {
  if (!plainPassword || !storedHash || !storedHash.startsWith('scrypt$')) {
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 3) return false;
  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;
  try {
    const derived = crypto.scryptSync(plainPassword, salt, 64);
    const expected = Buffer.from(hashHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ===================== SIGNED SESSION TOKEN (HMAC-SHA256) =====================

export interface RbacTokenPayload {
  uid: string;
  username: string;
  iat: number;
  exp: number;
}

export function signRbacToken(user: RbacUserRecord): string {
  const now = Date.now();
  const payload: RbacTokenPayload = {
    uid: user.id,
    username: user.username,
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');
  return `rbac_${encoded}.${sig}`;
}

export function verifyRbacToken(token: string): RbacTokenPayload | null {
  if (!token || !token.startsWith('rbac_')) return null;
  const raw = token.slice('rbac_'.length);
  const dotIdx = raw.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = raw.slice(0, dotIdx);
  const providedSig = raw.slice(dotIdx + 1);
  if (!encoded || !providedSig) return null;

  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encoded)
    .digest('base64url');

  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as RbacTokenPayload;
    if (!decoded || typeof decoded.uid !== 'string' || typeof decoded.exp !== 'number') {
      return null;
    }
    if (Date.now() > decoded.exp) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

// ===================== SEED DATA BUILDER =====================

function createSeededRoles(nowIso: string): RbacRoleRecord[] {
  const adminRole: RbacRoleRecord = {
    id: 'role-adm01',
    code: 'ADM01',
    name: 'Administrator',
    description:
      'Akses penuh ke seluruh modul ERP, BI, SOP, Aset, Manajemen Pengguna, dan Pengaturan Sistem.',
    isSystemAdmin: true,
    permissions: createFullPermissionMatrix(),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const financeRole: RbacRoleRecord = {
    id: 'role-fin01',
    code: 'FIN01',
    name: 'Finance',
    description:
      'Akses penuh ke modul Keuangan, Laporan Laba Rugi, Neraca, Pembayaran Supplier, Hutang/Piutang, dan BI Keuangan.',
    isSystemAdmin: false,
    permissions: buildPresetPermissionMatrix({
      dashboard: ['favorite', 'view', 'data'],
      ask_ai: ['favorite', 'view', 'data'],
      notifications: ['view', 'insert', 'notify'],
      erp_finance: ['favorite', 'view', 'insert', 'update', 'data', 'approve', 'notify'],
      erp_bi_finance: ['favorite', 'view', 'data'],
      erp_bi_purchasing: ['view', 'data'],
      erp_bi_sales: ['view', 'data'],
      erp_po: ['view', 'data', 'approve'],
      erp_ri: ['view', 'insert', 'update', 'data', 'approve', 'notify'],
      erp_vp: ['favorite', 'view', 'insert', 'update', 'data', 'approve', 'notify'],
      erp_ap: ['favorite', 'view', 'data', 'approve', 'notify'],
      erp_si: ['view', 'data', 'notify'],
      erp_ar: ['view', 'data', 'approve', 'notify'],
      erp_assets: ['view', 'data'],
      sop_read: ['view'],
      meetings: ['view', 'insert', 'update', 'notify'],
    }),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const salesRole: RbacRoleRecord = {
    id: 'role-sal01',
    code: 'SAL01',
    name: 'Sales',
    description:
      'Akses ke modul Penjualan (SO, DO, SI, Retur), stok barang untuk cek ketersediaan, BI Sales, SOP, dan Meeting.',
    isSystemAdmin: false,
    permissions: buildPresetPermissionMatrix({
      dashboard: ['favorite', 'view', 'data'],
      ask_ai: ['favorite', 'view', 'data'],
      notifications_inbox: ['view', 'notify'],
      erp_so: ['favorite', 'view', 'insert', 'update', 'data'],
      erp_do: ['view', 'insert', 'update', 'data', 'notify'],
      erp_si: ['view', 'data', 'notify'],
      erp_sr: ['view', 'insert', 'data'],
      erp_ar: ['view', 'data'],
      erp_stock_list: ['view', 'data'],
      erp_bi_sales: ['favorite', 'view', 'data'],
      sop_read: ['view'],
      meetings: ['view', 'insert', 'update', 'notify'],
    }),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const staffRole: RbacRoleRecord = {
    id: 'role-staff',
    code: 'STAFF',
    name: 'Karyawan Biasa',
    description:
      'Akses terbatas untuk SOP umum, jadwal meeting, inventaris aset, dan Ask AI khusus prosedur non-sensitif (tanpa data keuangan/pembayaran/admin).',
    isSystemAdmin: false,
    permissions: buildPresetPermissionMatrix({
      dashboard_kpi: ['view'],
      ask_ai_sop: ['favorite', 'view'],
      notifications_inbox: ['view', 'notify'],
      assets_maint: ['view', 'notify'],
      sop_read: ['favorite', 'view'],
      meetings: ['view', 'insert', 'notify'],
    }),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return [adminRole, financeRole, salesRole, staffRole];
}

function createSeededUsers(nowIso: string): RbacUserRecord[] {
  return [
    {
      id: 'usr-superuser',
      username: 'superuser',
      fullName: 'Super User',
      email: 'superuser@sopbrain.app',
      roleId: 'role-adm01',
      passwordHash: hashPassword('SuperUser#2026'),
      isActive: true,
      lastLoginAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'usr-admin-magfur',
      username: 'ahmad.admin',
      fullName: 'Ahmad Magfur',
      email: 'ahmadmagfur1218@gmail.com',
      roleId: 'role-adm01',
      passwordHash: hashPassword('Admin#2026'),
      isActive: true,
      lastLoginAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'usr-fin-rina',
      username: 'rina.finance',
      fullName: 'Rina Kusuma',
      email: 'rina.finance@company.co.id',
      roleId: 'role-fin01',
      passwordHash: hashPassword('Finance#2026'),
      isActive: true,
      lastLoginAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'usr-fin-budi',
      username: 'budi.finance',
      fullName: 'Budi Santoso',
      email: 'budi.finance@company.co.id',
      roleId: 'role-fin01',
      passwordHash: hashPassword('Finance#2026'),
      isActive: true,
      lastLoginAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'usr-sal-andi',
      username: 'andi.sales',
      fullName: 'Andi Pratama',
      email: 'andi.sales@company.co.id',
      roleId: 'role-sal01',
      passwordHash: hashPassword('Sales#2026'),
      isActive: true,
      lastLoginAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'usr-sal-dewi',
      username: 'dewi.sales',
      fullName: 'Dewi Anggraini',
      email: 'dewi.sales@company.co.id',
      roleId: 'role-sal01',
      passwordHash: hashPassword('Sales#2026'),
      isActive: true,
      lastLoginAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'usr-staff-siti',
      username: 'siti.staff',
      fullName: 'Siti Rahmawati',
      email: 'siti.staff@company.co.id',
      roleId: 'role-staff',
      passwordHash: hashPassword('Staff#2026'),
      isActive: true,
      lastLoginAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'usr-staff-hendra',
      username: 'hendra.staff',
      fullName: 'Hendra Wijaya',
      email: 'hendra.staff@company.co.id',
      roleId: 'role-staff',
      passwordHash: hashPassword('Staff#2026'),
      isActive: true,
      lastLoginAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];
}

// ===================== STORE PERSISTENCE =====================

let cachedStore: RbacStoreData | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveStore(store: RbacStoreData): void {
  ensureDataDir();
  const tmpPath = `${STORE_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmpPath, STORE_PATH);
  cachedStore = store;
}

function loadStore(): RbacStoreData {
  if (cachedStore) return cachedStore;

  const nowIso = new Date().toISOString();
  if (fs.existsSync(STORE_PATH)) {
    try {
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as RbacStoreData;
      if (parsed && Array.isArray(parsed.roles) && Array.isArray(parsed.users)) {
        // Auto-sync any newly added menus from MENU_REGISTRY_TREE into existing roles
        parsed.roles = parsed.roles.map((r) => ({
          ...r,
          permissions: normalizePermissionMatrix(r.permissions, r.isSystemAdmin),
        }));
        if (!Array.isArray(parsed.auditLogs)) {
          parsed.auditLogs = [];
        }
        // Ensure ADM01 exists
        if (!parsed.roles.some((r) => r.isSystemAdmin || r.code === 'ADM01')) {
          parsed.roles.unshift(createSeededRoles(nowIso)[0]);
        }
        cachedStore = parsed;
        return cachedStore;
      }
    } catch (err) {
      console.error('Failed to read RBAC store, re-seeding:', err);
    }
  }

  const seeded: RbacStoreData = {
    version: 1,
    roles: createSeededRoles(nowIso),
    users: createSeededUsers(nowIso),
    auditLogs: [
      {
        id: `aud-${crypto.randomUUID()}`,
        actorId: 'system',
        actorUsername: 'system',
        actorName: 'Inisialisasi Sistem',
        actorRoleCode: 'ADM01',
        action: 'ROLE_CREATE',
        targetType: 'ROLE',
        targetId: 'role-adm01',
        targetLabel: 'ADM01 — Administrator',
        detail:
          'Inisialisasi role bawaan (ADM01 Administrator, FIN01 Finance, SAL01 Sales, STAFF Karyawan Biasa) dan akun demo.',
        createdAt: nowIso,
      },
    ],
  };
  saveStore(seeded);
  return seeded;
}

function appendAudit(
  store: RbacStoreData,
  actor: RbacActorContext,
  entry: Omit<RbacAuditLogEntry, 'id' | 'actorId' | 'actorUsername' | 'actorName' | 'actorRoleCode' | 'createdAt'>,
): void {
  const item: RbacAuditLogEntry = {
    id: `aud-${crypto.randomUUID()}`,
    actorId: actor.id,
    actorUsername: actor.username,
    actorName: actor.fullName,
    actorRoleCode: actor.roleCode,
    ...entry,
    createdAt: new Date().toISOString(),
  };
  store.auditLogs.unshift(item);
  if (store.auditLogs.length > 500) {
    store.auditLogs = store.auditLogs.slice(0, 500);
  }
}

// ===================== SAFE SERIALIZERS =====================

export function toSafeUser(user: RbacUserRecord, roles: RbacRoleRecord[]): SafeRbacUser {
  const role = roles.find((r) => r.id === user.roleId);
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    roleId: user.roleId,
    roleCode: role?.code ?? 'UNASSIGNED',
    roleName: role?.name ?? 'Tanpa Role',
    ...(user.divisionId ? { divisionId: user.divisionId } : {}),
    ...(user.divisionName ? { divisionName: user.divisionName } : {}),
    isSystemAdmin: Boolean(role?.isSystemAdmin),
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// ===================== AUTH & RESOLUTION =====================

export function authenticateRbacUser(identifier: string, password: string): {
  token: string;
  user: SafeRbacUser;
  role: RbacRoleRecord;
  permissions: RolePermissionMatrix;
} | { error: string; status: number } {
  const store = loadStore();
  const normalized = identifier.trim().toLowerCase();
  if (!normalized || !password) {
    return { error: 'Username/email dan kata sandi wajib diisi.', status: 400 };
  }

  const user = store.users.find(
    (u) => u.username.toLowerCase() === normalized || u.email.toLowerCase() === normalized,
  );
  if (!user) {
    return { error: 'Username atau kata sandi salah.', status: 401 };
  }

  if (!verifyPassword(password, user.passwordHash)) {
    return { error: 'Username atau kata sandi salah.', status: 401 };
  }

  if (!user.isActive) {
    return {
      error: 'Akun Anda berstatus Nonaktif. Hubungi Administrator untuk mengaktifkan kembali.',
      status: 403,
    };
  }

  const role = store.roles.find((r) => r.id === user.roleId);
  if (!role) {
    return {
      error: 'Role untuk akun ini tidak ditemukan. Hubungi Administrator.',
      status: 403,
    };
  }

  const nowIso = new Date().toISOString();
  user.lastLoginAt = nowIso;
  appendAudit(
    store,
    { id: user.id, username: user.username, fullName: user.fullName, roleCode: role.code },
    {
      action: 'AUTH_LOGIN',
      targetType: 'AUTH',
      targetId: user.id,
      targetLabel: `${user.username} (${role.code})`,
      detail: `Login berhasil sebagai ${role.name} (${role.code}).`,
    },
  );
  saveStore(store);

  const normalizedPerms = normalizePermissionMatrix(role.permissions, role.isSystemAdmin);
  return {
    token: signRbacToken(user),
    user: toSafeUser(user, store.roles),
    role: { ...role, permissions: normalizedPerms },
    permissions: normalizedPerms,
  };
}

export function resolveRbacSessionByUserId(userId: string): {
  user: SafeRbacUser;
  role: RbacRoleRecord;
  permissions: RolePermissionMatrix;
} | null {
  const store = loadStore();
  const user = store.users.find((u) => u.id === userId);
  if (!user || !user.isActive) return null;
  const role = store.roles.find((r) => r.id === user.roleId);
  if (!role) return null;
  const permissions = normalizePermissionMatrix(role.permissions, role.isSystemAdmin);
  return {
    user: toSafeUser(user, store.roles),
    role: { ...role, permissions },
    permissions,
  };
}

/**
 * Fallback resolver when a caller presents a verified Firebase ID Token
 * without an RBAC token (e.g. restored browser session).
 */
export function resolveRbacSessionByEmailOrUsername(email?: string): {
  user: SafeRbacUser;
  role: RbacRoleRecord;
  permissions: RolePermissionMatrix;
} | null {
  if (!email) return null;
  const store = loadStore();
  const normalized = email.trim().toLowerCase();
  const localPart = normalized.split('@')[0];

  const user = store.users.find(
    (u) =>
      u.email.toLowerCase() === normalized ||
      u.username.toLowerCase() === normalized ||
      u.username.toLowerCase() === localPart,
  );
  if (user) {
    if (!user.isActive) return null;
    const role = store.roles.find((r) => r.id === user.roleId);
    if (!role) return null;
    const permissions = normalizePermissionMatrix(role.permissions, role.isSystemAdmin);
    return {
      user: toSafeUser(user, store.roles),
      role: { ...role, permissions },
      permissions,
    };
  }

  // Unknown Firebase account defaults to least-privilege STAFF role (never Admin)
  const staffRole =
    store.roles.find((r) => r.code === 'STAFF') ??
    store.roles.find((r) => !r.isSystemAdmin) ??
    null;
  if (!staffRole) return null;
  const permissions = normalizePermissionMatrix(staffRole.permissions, false);
  const nowIso = new Date().toISOString();
  return {
    user: {
      id: `fb-${localPart}`,
      username: localPart,
      fullName: localPart,
      email: normalized,
      roleId: staffRole.id,
      roleCode: staffRole.code,
      roleName: staffRole.name,
      isSystemAdmin: false,
      isActive: true,
      lastLoginAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    role: { ...staffRole, permissions },
    permissions,
  };
}

export function getPublicDemoDirectory(): Array<{
  username: string;
  fullName: string;
  email: string;
  roleCode: string;
  roleName: string;
  isActive: boolean;
}> {
  const store = loadStore();
  return store.users
    .filter((u) => u.isActive)
    .map((u) => {
      const role = store.roles.find((r) => r.id === u.roleId);
      return {
        username: u.username,
        fullName: u.fullName,
        email: u.email,
        roleCode: role?.code ?? 'STAFF',
        roleName: role?.name ?? 'Staff',
        isActive: u.isActive,
      };
    });
}

// ===================== ROLE CRUD =====================

export function listRbacRoles(): Array<
  RbacRoleRecord & { userCount: number; activeUserCount: number }
> {
  const store = loadStore();
  return store.roles.map((role) => {
    const assigned = store.users.filter((u) => u.roleId === role.id);
    return {
      ...role,
      permissions: normalizePermissionMatrix(role.permissions, role.isSystemAdmin),
      userCount: assigned.length,
      activeUserCount: assigned.filter((u) => u.isActive).length,
    };
  });
}

export function getMenuRegistryPayload() {
  return {
    tabs: MENU_MODULE_TABS,
    tree: MENU_REGISTRY_TREE,
  };
}

export function createRbacRole(
  input: {
    code: string;
    name: string;
    description?: string;
    permissions?: Partial<RolePermissionMatrix>;
  },
  actor: RbacActorContext,
): { role: RbacRoleRecord } | { error: string; status: number } {
  const store = loadStore();
  const code = (input.code || '').trim().toUpperCase();
  const name = (input.name || '').trim();
  const description = (input.description || '').trim();

  if (!code || !/^[A-Z0-9_-]{2,20}$/.test(code)) {
    return {
      error: 'Kode role wajib diisi (2–20 karakter huruf besar, angka, garis bawah, atau tanda hubung).',
      status: 400,
    };
  }
  if (!name || name.length < 2 || name.length > 80) {
    return { error: 'Nama role wajib diisi (2–80 karakter).', status: 400 };
  }
  if (store.roles.some((r) => r.code.toUpperCase() === code)) {
    return { error: `Kode role "${code}" sudah digunakan.`, status: 409 };
  }

  // Default for new roles: ALL unchecked (minimum privilege) unless explicitly passed
  const permissions = input.permissions
    ? normalizePermissionMatrix(input.permissions, false)
    : createEmptyPermissionMatrix();

  const nowIso = new Date().toISOString();
  const newRole: RbacRoleRecord = {
    id: `role-${crypto.randomUUID().slice(0, 8)}`,
    code,
    name,
    description,
    isSystemAdmin: false,
    permissions,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  store.roles.push(newRole);
  appendAudit(store, actor, {
    action: 'ROLE_CREATE',
    targetType: 'ROLE',
    targetId: newRole.id,
    targetLabel: `${newRole.code} — ${newRole.name}`,
    detail: `Menambahkan role baru "${newRole.code} (${newRole.name})".`,
  });
  saveStore(store);

  return { role: newRole };
}

export function updateRbacRole(
  roleId: string,
  input: {
    code?: string;
    name?: string;
    description?: string;
    permissions?: Partial<RolePermissionMatrix>;
  },
  actor: RbacActorContext,
): { role: RbacRoleRecord } | { error: string; status: number } {
  const store = loadStore();
  const idx = store.roles.findIndex((r) => r.id === roleId);
  if (idx === -1) {
    return { error: 'Role tidak ditemukan.', status: 404 };
  }

  const existing = store.roles[idx];
  const nextCode = existing.isSystemAdmin
    ? existing.code
    : (input.code ?? existing.code).trim().toUpperCase();
  const nextName = (input.name ?? existing.name).trim();
  const nextDescription =
    input.description !== undefined ? input.description.trim() : existing.description;

  if (!nextCode || !/^[A-Z0-9_-]{2,20}$/.test(nextCode)) {
    return {
      error: 'Kode role tidak valid (2–20 karakter huruf besar, angka, _, -).',
      status: 400,
    };
  }
  if (!nextName || nextName.length < 2 || nextName.length > 80) {
    return { error: 'Nama role wajib diisi (2–80 karakter).', status: 400 };
  }
  if (
    nextCode !== existing.code &&
    store.roles.some((r) => r.id !== roleId && r.code.toUpperCase() === nextCode)
  ) {
    return { error: `Kode role "${nextCode}" sudah digunakan role lain.`, status: 409 };
  }

  const nextPermissions = input.permissions
    ? normalizePermissionMatrix(input.permissions, existing.isSystemAdmin)
    : normalizePermissionMatrix(existing.permissions, existing.isSystemAdmin);

  const permissionsChanged =
    JSON.stringify(existing.permissions) !== JSON.stringify(nextPermissions);

  const updated: RbacRoleRecord = {
    ...existing,
    code: nextCode,
    name: nextName,
    description: nextDescription,
    permissions: nextPermissions,
    updatedAt: new Date().toISOString(),
  };

  store.roles[idx] = updated;
  appendAudit(store, actor, {
    action: permissionsChanged ? 'ROLE_PERMISSIONS_UPDATE' : 'ROLE_UPDATE',
    targetType: 'ROLE',
    targetId: updated.id,
    targetLabel: `${updated.code} — ${updated.name}`,
    detail: permissionsChanged
      ? `Memperbarui detail & matriks hak akses role "${updated.code} (${updated.name})".`
      : `Memperbarui informasi role "${updated.code} (${updated.name})".`,
  });
  saveStore(store);

  return { role: updated };
}

export function deleteRbacRole(
  roleId: string,
  actor: RbacActorContext,
): { ok: true } | { error: string; status: number } {
  const store = loadStore();
  const role = store.roles.find((r) => r.id === roleId);
  if (!role) {
    return { error: 'Role tidak ditemukan.', status: 404 };
  }
  if (role.isSystemAdmin || role.code === 'ADM01') {
    return {
      error: 'Role Administrator (ADM01) dilindungi sistem dan tidak dapat dihapus.',
      status: 400,
    };
  }

  const assignedUsers = store.users.filter((u) => u.roleId === roleId);
  if (assignedUsers.length > 0) {
    return {
      error: `Role "${role.code}" masih digunakan oleh ${assignedUsers.length} pengguna. Pindahkan pengguna ke role lain terlebih dahulu sebelum menghapus.`,
      status: 400,
    };
  }

  store.roles = store.roles.filter((r) => r.id !== roleId);
  appendAudit(store, actor, {
    action: 'ROLE_DELETE',
    targetType: 'ROLE',
    targetId: role.id,
    targetLabel: `${role.code} — ${role.name}`,
    detail: `Menghapus role "${role.code} (${role.name})".`,
  });
  saveStore(store);

  return { ok: true };
}

// ===================== USER LOGIN CRUD =====================

function countActiveAdminUsers(store: RbacStoreData, excludeUserId?: string): number {
  const adminRoleIds = new Set(
    store.roles.filter((r) => r.isSystemAdmin || r.code === 'ADM01').map((r) => r.id),
  );
  return store.users.filter(
    (u) => u.id !== excludeUserId && u.isActive && adminRoleIds.has(u.roleId),
  ).length;
}

export function listRbacUsers(): SafeRbacUser[] {
  const store = loadStore();
  return store.users.map((u) => toSafeUser(u, store.roles));
}

export function createRbacUser(
  input: {
    username: string;
    fullName: string;
    email: string;
    roleId: string;
    divisionId?: string;
    divisionName?: string;
    password: string;
    isActive?: boolean;
  },
  actor: RbacActorContext,
): { user: SafeRbacUser } | { error: string; status: number } {
  const store = loadStore();
  const username = (input.username || '').trim().toLowerCase();
  const fullName = (input.fullName || '').trim();
  const email = (input.email || '').trim().toLowerCase();
  const password = input.password || '';
  const divisionId = (input.divisionId || '').trim();
  const divisionName = (input.divisionName || '').trim();

  if (!username || !/^[a-z0-9._-]{3,40}$/.test(username)) {
    return {
      error: 'Username wajib 3–40 karakter (huruf kecil, angka, titik, garis bawah, atau tanda hubung).',
      status: 400,
    };
  }
  if (!fullName || fullName.length < 2 || fullName.length > 100) {
    return { error: 'Nama lengkap wajib diisi (2–100 karakter).', status: 400 };
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'Format email tidak valid.', status: 400 };
  }
  if (!password || password.length < 6) {
    return { error: 'Kata sandi awal minimal 6 karakter.', status: 400 };
  }

  const role = store.roles.find((r) => r.id === input.roleId);
  if (!role) {
    return { error: 'Role yang dipilih tidak ditemukan.', status: 400 };
  }

  if (store.users.some((u) => u.username.toLowerCase() === username)) {
    return { error: `Username "${username}" sudah terdaftar. Gunakan username lain.`, status: 409 };
  }
  if (store.users.some((u) => u.email.toLowerCase() === email)) {
    return { error: `Email "${email}" sudah terdaftar pada pengguna lain.`, status: 409 };
  }

  const nowIso = new Date().toISOString();
  const newUser: RbacUserRecord = {
    id: `usr-${crypto.randomUUID().slice(0, 8)}`,
    username,
    fullName,
    email,
    roleId: role.id,
    ...(divisionId ? { divisionId } : {}),
    ...(divisionName ? { divisionName } : {}),
    passwordHash: hashPassword(password),
    isActive: input.isActive !== false,
    lastLoginAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  store.users.push(newUser);
  appendAudit(store, actor, {
    action: 'USER_CREATE',
    targetType: 'USER',
    targetId: newUser.id,
    targetLabel: `${newUser.username} (${newUser.fullName})`,
    detail: `Menambahkan user login "${newUser.username}" dengan role ${role.code} (${role.name})${divisionName ? ` · Divisi: ${divisionName}` : ''}.`,
  });
  saveStore(store);

  return { user: toSafeUser(newUser, store.roles) };
}

export function updateRbacUser(
  userId: string,
  input: {
    username?: string;
    fullName?: string;
    email?: string;
    roleId?: string;
    divisionId?: string;
    divisionName?: string;
    isActive?: boolean;
  },
  actor: RbacActorContext,
): { user: SafeRbacUser } | { error: string; status: number } {
  const store = loadStore();
  const idx = store.users.findIndex((u) => u.id === userId);
  if (idx === -1) {
    return { error: 'Pengguna tidak ditemukan.', status: 404 };
  }

  const existing = store.users[idx];
  const nextUsername = (input.username ?? existing.username).trim().toLowerCase();
  const nextFullName = (input.fullName ?? existing.fullName).trim();
  const nextEmail = (input.email ?? existing.email).trim().toLowerCase();
  const nextRoleId = input.roleId ?? existing.roleId;
  const nextDivisionId =
    input.divisionId !== undefined ? input.divisionId.trim() : existing.divisionId || '';
  const nextDivisionName =
    input.divisionName !== undefined ? input.divisionName.trim() : existing.divisionName || '';
  const nextActive = input.isActive !== undefined ? Boolean(input.isActive) : existing.isActive;

  if (!nextUsername || !/^[a-z0-9._-]{3,40}$/.test(nextUsername)) {
    return { error: 'Format username tidak valid.', status: 400 };
  }
  if (!nextFullName || nextFullName.length < 2 || nextFullName.length > 100) {
    return { error: 'Nama lengkap wajib diisi (2–100 karakter).', status: 400 };
  }
  if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
    return { error: 'Format email tidak valid.', status: 400 };
  }

  const prevRole = store.roles.find((r) => r.id === existing.roleId);
  const nextRole = store.roles.find((r) => r.id === nextRoleId);
  if (!nextRole) {
    return { error: 'Role yang dipilih tidak valid.', status: 400 };
  }

  if (
    nextUsername !== existing.username &&
    store.users.some((u) => u.id !== userId && u.username.toLowerCase() === nextUsername)
  ) {
    return { error: `Username "${nextUsername}" sudah digunakan.`, status: 409 };
  }
  if (
    nextEmail !== existing.email &&
    store.users.some((u) => u.id !== userId && u.email.toLowerCase() === nextEmail)
  ) {
    return { error: `Email "${nextEmail}" sudah digunakan.`, status: 409 };
  }

  // Safeguard: always keep at least 1 active Administrator
  const wasActiveAdmin = existing.isActive && Boolean(prevRole?.isSystemAdmin);
  const remainsActiveAdmin = nextActive && Boolean(nextRole.isSystemAdmin);
  if (wasActiveAdmin && !remainsActiveAdmin && countActiveAdminUsers(store, userId) === 0) {
    return {
      error: 'Tidak dapat menonaktifkan atau menurunkan role Administrator terakhir yang aktif.',
      status: 400,
    };
  }

  const roleChanged = existing.roleId !== nextRole.id;
  const statusChanged = existing.isActive !== nextActive;

  const updated: RbacUserRecord = {
    ...existing,
    username: nextUsername,
    fullName: nextFullName,
    email: nextEmail,
    roleId: nextRole.id,
    divisionId: nextDivisionId || undefined,
    divisionName: nextDivisionName || undefined,
    isActive: nextActive,
    updatedAt: new Date().toISOString(),
  };

  store.users[idx] = updated;

  const detailParts: string[] = [];
  if (roleChanged) {
    detailParts.push(
      `Role diubah dari ${prevRole?.code ?? '-'} ke ${nextRole.code} (${nextRole.name})`,
    );
  }
  if (statusChanged) {
    detailParts.push(`Status diubah menjadi ${nextActive ? 'Aktif' : 'Nonaktif'}`);
  }
  if (detailParts.length === 0) {
    detailParts.push('Profil user login diperbarui');
  }

  appendAudit(store, actor, {
    action: roleChanged ? 'USER_ROLE_CHANGE' : statusChanged ? 'USER_STATUS_CHANGE' : 'USER_UPDATE',
    targetType: 'USER',
    targetId: updated.id,
    targetLabel: `${updated.username} (${updated.fullName})`,
    detail: detailParts.join('; ') + '.',
  });
  saveStore(store);

  return { user: toSafeUser(updated, store.roles) };
}

export function resetRbacUserPassword(
  userId: string,
  newPassword: string,
  actor: RbacActorContext,
): { ok: true } | { error: string; status: number } {
  const store = loadStore();
  const user = store.users.find((u) => u.id === userId);
  if (!user) {
    return { error: 'Pengguna tidak ditemukan.', status: 404 };
  }
  if (!newPassword || newPassword.length < 6) {
    return { error: 'Kata sandi baru minimal 6 karakter.', status: 400 };
  }

  user.passwordHash = hashPassword(newPassword);
  user.updatedAt = new Date().toISOString();

  appendAudit(store, actor, {
    action: 'USER_PASSWORD_RESET',
    targetType: 'USER',
    targetId: user.id,
    targetLabel: `${user.username} (${user.fullName})`,
    detail: `Reset kata sandi untuk akun "${user.username}" (disimpan sebagai hash terenkripsi).`,
  });
  saveStore(store);

  return { ok: true };
}

export function deleteRbacUser(
  userId: string,
  actor: RbacActorContext,
): { ok: true } | { error: string; status: number } {
  const store = loadStore();
  const user = store.users.find((u) => u.id === userId);
  if (!user) {
    return { error: 'Pengguna tidak ditemukan.', status: 404 };
  }
  if (user.id === actor.id) {
    return {
      error: 'Anda tidak dapat menghapus akun yang sedang digunakan untuk login.',
      status: 400,
    };
  }

  const role = store.roles.find((r) => r.id === user.roleId);
  if (user.isActive && role?.isSystemAdmin && countActiveAdminUsers(store, userId) === 0) {
    return {
      error: 'Tidak dapat menghapus Administrator terakhir yang aktif. Minimal harus ada satu Administrator aktif.',
      status: 400,
    };
  }

  store.users = store.users.filter((u) => u.id !== userId);
  appendAudit(store, actor, {
    action: 'USER_DELETE',
    targetType: 'USER',
    targetId: user.id,
    targetLabel: `${user.username} (${user.fullName})`,
    detail: `Menghapus user login "${user.username}" (role sebelumnya: ${role?.code ?? '-'}).`,
  });
  saveStore(store);

  return { ok: true };
}

export function listRbacAuditLogs(limit = 150): RbacAuditLogEntry[] {
  const store = loadStore();
  return store.auditLogs.slice(0, Math.min(limit, 500));
}
