import type {
  MenuModuleTab,
  MenuTreeNode,
  RolePermissionMatrix,
} from '../config/menuRegistry';
import { fetchApiJson } from './apiClient';

/**
 * In-memory RBAC session token store (never written to localStorage or sessionStorage).
 */
let inMemoryRbacToken: string | null = null;

export function getRbacToken(): string | null {
  return inMemoryRbacToken;
}

export function setRbacToken(token: string | null): void {
  inMemoryRbacToken = token && token.trim() ? token.trim() : null;
}

export function clearRbacToken(): void {
  inMemoryRbacToken = null;
}

export interface RbacRoleItem {
  id: string;
  code: string;
  name: string;
  description: string;
  isSystemAdmin: boolean;
  permissions: RolePermissionMatrix;
  userCount?: number;
  activeUserCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface RbacUserItem {
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

export interface RbacAuditLogItem {
  id: string;
  actorId: string;
  actorUsername: string;
  actorName: string;
  actorRoleCode: string;
  action: string;
  targetType: 'ROLE' | 'USER' | 'AUTH';
  targetId: string;
  targetLabel: string;
  detail: string;
  createdAt: string;
}

export interface RbacRegistryPayload {
  tabs: MenuModuleTab[];
  tree: MenuTreeNode[];
}

export interface RbacSessionState {
  token: string | null;
  user: RbacUserItem;
  role: RbacRoleItem;
  permissions: RolePermissionMatrix;
  registry: RbacRegistryPayload;
}

export interface PublicDemoAccount {
  username: string;
  fullName: string;
  email: string;
  roleCode: string;
  roleName: string;
  isActive: boolean;
}

function authJsonHeaders(firebaseIdToken?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const rbacToken = getRbacToken();
  if (firebaseIdToken) {
    headers.Authorization = `Bearer ${firebaseIdToken}`;
    if (rbacToken) headers['X-Rbac-Token'] = rbacToken;
  } else if (rbacToken) {
    headers.Authorization = `Bearer ${rbacToken}`;
    headers['X-Rbac-Token'] = rbacToken;
  }
  return headers;
}

export async function rbacLoginApi(
  identifier: string,
  password: string
): Promise<RbacSessionState> {
  const data = await fetchApiJson<RbacSessionState>(
    '/api/rbac/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    },
    'Username atau kata sandi salah.'
  );
  if (data.token) {
    setRbacToken(data.token);
  }
  return data;
}

export async function fetchRbacMeApi(
  firebaseIdToken?: string | null
): Promise<Omit<RbacSessionState, 'token'>> {
  return fetchApiJson<Omit<RbacSessionState, 'token'>>(
    '/api/rbac/me',
    {
      method: 'GET',
      headers: authJsonHeaders(firebaseIdToken),
    },
    'Gagal memuat profil hak akses pengguna.'
  );
}

export async function fetchPublicDemoAccountsApi(): Promise<{ accounts: PublicDemoAccount[] }> {
  return fetchApiJson<{ accounts: PublicDemoAccount[] }>(
    '/api/rbac/demo-accounts',
    { method: 'GET' },
    'Gagal memuat daftar akun demo.'
  );
}

export async function fetchRbacRolesApi(
  firebaseIdToken?: string | null
): Promise<{ roles: RbacRoleItem[]; registry: RbacRegistryPayload }> {
  return fetchApiJson<{ roles: RbacRoleItem[]; registry: RbacRegistryPayload }>(
    '/api/rbac/roles',
    {
      method: 'GET',
      headers: authJsonHeaders(firebaseIdToken),
    },
    'Gagal memuat daftar User Role.'
  );
}

export async function createRbacRoleApi(
  payload: {
    code: string;
    name: string;
    description?: string;
    permissions?: Partial<RolePermissionMatrix>;
  },
  firebaseIdToken?: string | null
): Promise<{ role: RbacRoleItem }> {
  return fetchApiJson<{ role: RbacRoleItem }>(
    '/api/rbac/roles',
    {
      method: 'POST',
      headers: authJsonHeaders(firebaseIdToken),
      body: JSON.stringify(payload),
    },
    'Gagal menambahkan User Role baru.'
  );
}

export async function updateRbacRoleApi(
  roleId: string,
  payload: {
    code?: string;
    name?: string;
    description?: string;
    permissions?: Partial<RolePermissionMatrix>;
  },
  firebaseIdToken?: string | null
): Promise<{ role: RbacRoleItem }> {
  return fetchApiJson<{ role: RbacRoleItem }>(
    `/api/rbac/roles/${encodeURIComponent(roleId)}`,
    {
      method: 'PUT',
      headers: authJsonHeaders(firebaseIdToken),
      body: JSON.stringify(payload),
    },
    'Gagal menyimpan perubahan User Role.'
  );
}

export async function deleteRbacRoleApi(
  roleId: string,
  firebaseIdToken?: string | null
): Promise<{ ok: boolean }> {
  return fetchApiJson<{ ok: boolean }>(
    `/api/rbac/roles/${encodeURIComponent(roleId)}`,
    {
      method: 'DELETE',
      headers: authJsonHeaders(firebaseIdToken),
    },
    'Gagal menghapus User Role.'
  );
}

export async function fetchRbacUsersApi(
  firebaseIdToken?: string | null
): Promise<{ users: RbacUserItem[] }> {
  return fetchApiJson<{ users: RbacUserItem[] }>(
    '/api/rbac/users',
    {
      method: 'GET',
      headers: authJsonHeaders(firebaseIdToken),
    },
    'Gagal memuat daftar User Login.'
  );
}

export async function createRbacUserApi(
  payload: {
    username: string;
    fullName: string;
    email: string;
    roleId: string;
    divisionId?: string;
    divisionName?: string;
    password: string;
    isActive?: boolean;
  },
  firebaseIdToken?: string | null
): Promise<{ user: RbacUserItem }> {
  return fetchApiJson<{ user: RbacUserItem }>(
    '/api/rbac/users',
    {
      method: 'POST',
      headers: authJsonHeaders(firebaseIdToken),
      body: JSON.stringify(payload),
    },
    'Gagal membuat User Login baru.'
  );
}

export async function updateRbacUserApi(
  userId: string,
  payload: {
    username?: string;
    fullName?: string;
    email?: string;
    roleId?: string;
    divisionId?: string;
    divisionName?: string;
    isActive?: boolean;
  },
  firebaseIdToken?: string | null
): Promise<{ user: RbacUserItem }> {
  return fetchApiJson<{ user: RbacUserItem }>(
    `/api/rbac/users/${encodeURIComponent(userId)}`,
    {
      method: 'PUT',
      headers: authJsonHeaders(firebaseIdToken),
      body: JSON.stringify(payload),
    },
    'Gagal memperbarui data User Login.'
  );
}

export async function toggleRbacUserStatusApi(
  userId: string,
  isActive: boolean,
  firebaseIdToken?: string | null
): Promise<{ user: RbacUserItem }> {
  return fetchApiJson<{ user: RbacUserItem }>(
    `/api/rbac/users/${encodeURIComponent(userId)}/status`,
    {
      method: 'PATCH',
      headers: authJsonHeaders(firebaseIdToken),
      body: JSON.stringify({ isActive }),
    },
    'Gagal mengubah status User Login.'
  );
}

export async function resetRbacUserPasswordApi(
  userId: string,
  newPassword: string,
  firebaseIdToken?: string | null
): Promise<{ ok: boolean }> {
  return fetchApiJson<{ ok: boolean }>(
    `/api/rbac/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: 'POST',
      headers: authJsonHeaders(firebaseIdToken),
      body: JSON.stringify({ newPassword }),
    },
    'Gagal mereset kata sandi pengguna.'
  );
}

export async function deleteRbacUserApi(
  userId: string,
  firebaseIdToken?: string | null
): Promise<{ ok: boolean }> {
  return fetchApiJson<{ ok: boolean }>(
    `/api/rbac/users/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
      headers: authJsonHeaders(firebaseIdToken),
    },
    'Gagal menghapus User Login.'
  );
}

export async function fetchRbacAuditLogsApi(
  limit = 150,
  firebaseIdToken?: string | null
): Promise<{ logs: RbacAuditLogItem[] }> {
  return fetchApiJson<{ logs: RbacAuditLogItem[] }>(
    `/api/rbac/audit-logs?limit=${limit}`,
    {
      method: 'GET',
      headers: authJsonHeaders(firebaseIdToken),
    },
    'Gagal memuat audit log hak akses.'
  );
}
