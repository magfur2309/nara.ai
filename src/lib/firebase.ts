import { deleteApp, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
  type UserCredential,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { UserRole } from '../types/sop';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const DEFAULT_LOGIN_DOMAIN = 'sopbrain.app';
export const BOOTSTRAP_ADMIN_EMAIL = 'ahmadmagfur1218@gmail.com';
export const BOOTSTRAP_ADMIN_EMAILS = [
  'ahmadmagfur1218@gmail.com',
  'superuser@sopbrain.app',
] as const;
export const DEFAULT_DIVISION_ADMIN_EMAIL = 'admin@sopbrain.app';

export function isBootstrapAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return (BOOTSTRAP_ADMIN_EMAILS as readonly string[]).includes(normalized);
}

export interface DefaultRoleAccount {
  id: 'superuser' | 'admin' | 'user';
  label: string;
  role: UserRole;
  username: string;
  email: string;
  password: string;
  displayName: string;
  permissionsSummary: string;
}

export const DEFAULT_ROLE_ACCOUNTS: DefaultRoleAccount[] = [
  {
    id: 'superuser',
    label: 'Super User',
    role: 'Super Admin',
    username: 'superuser',
    email: 'superuser@sopbrain.app',
    password: 'SuperUser#2026',
    displayName: 'Super User',
    permissionsSummary:
      'Akses penuh: Tanya AI, kelola & setujui seluruh SOP, Impor & Buat AI, Organisasi, dan Manajemen Akun Pengguna.',
  },
  {
    id: 'admin',
    label: 'Admin',
    role: 'Admin Divisi',
    username: 'admin',
    email: 'admin@sopbrain.app',
    password: 'Admin#2026',
    displayName: 'Admin Divisi',
    permissionsSummary:
      'Kelola & setujui SOP divisi, Impor & Buat AI, serta pantau Analitik & Audit Log divisi.',
  },
  {
    id: 'user',
    label: 'User',
    role: 'Karyawan',
    username: 'user',
    email: 'user@sopbrain.app',
    password: 'User#2026',
    displayName: 'User Karyawan',
    permissionsSummary:
      'Tanya AI berbasis SOP resmi dan membaca dokumen SOP berstatus Disetujui sesuai hak akses.',
  },
];

export function normalizeLoginIdentifier(identifier: string): string {
  const trimmed = identifier.trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.includes('@')) return trimmed;
  const safeLocal = trimmed.replace(/[^a-z0-9._-]/g, '');
  return safeLocal ? `${safeLocal}@${DEFAULT_LOGIN_DOMAIN}` : '';
}

export function getRoleDisplayLabel(role: UserRole): string {
  switch (role) {
    case 'Super Admin':
      return 'Super User';
    case 'Admin Divisi':
      return 'Admin';
    case 'Penulis':
      return 'Penulis';
    case 'Karyawan':
      return 'User';
  }
}

export function formatAuthError(err: unknown): {
  message: string;
  isProviderDisabled: boolean;
} {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const rawMessage = err instanceof Error ? err.message : String(err || '');

  if (
    code === 'auth/operation-not-allowed' ||
    code === 'auth/configuration-not-found' ||
    rawMessage.includes('operation-not-allowed') ||
    rawMessage.includes('CONFIGURATION_NOT_FOUND')
  ) {
    return {
      message:
        'Metode login Email/Password belum diaktifkan di Firebase Console proyek ini. Aktifkan provider "Email/Password" di Authentication → Sign-in method terlebih dahulu.',
      isProviderDisabled: true,
    };
  }

  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return {
      message: 'Username atau kata sandi salah. Periksa kembali kredensial Anda.',
      isProviderDisabled: false,
    };
  }

  if (code === 'auth/invalid-email') {
    return {
      message: 'Format username tidak valid.',
      isProviderDisabled: false,
    };
  }

  if (code === 'auth/weak-password') {
    return {
      message: 'Kata sandi terlalu lemah. Gunakan minimal 6 karakter.',
      isProviderDisabled: false,
    };
  }

  if (code === 'auth/email-already-in-use') {
    return {
      message: 'Username atau email tersebut sudah terdaftar di sistem.',
      isProviderDisabled: false,
    };
  }

  if (code === 'auth/too-many-requests') {
    return {
      message: 'Terlalu banyak percobaan masuk. Tunggu beberapa saat lalu coba lagi.',
      isProviderDisabled: false,
    };
  }

  return {
    message: rawMessage || 'Gagal masuk akun. Silakan coba kembali.',
    isProviderDisabled: false,
  };
}

export async function signInWithCredentials(
  identifier: string,
  password: string,
  rememberMe = true
): Promise<UserCredential> {
  const email = normalizeLoginIdentifier(identifier);
  if (!email) {
    throw new Error('Masukkan email perusahaan atau username Anda terlebih dahulu.');
  }
  if (!password) {
    throw new Error('Masukkan kata sandi Anda terlebih dahulu.');
  }

  // Titik integrasi persistensi sesi Firebase Auth (tetap aman bila browser membatasi storage)
  try {
    await setPersistence(
      auth,
      rememberMe ? browserLocalPersistence : browserSessionPersistence
    );
  } catch {
    // Fallback ke persistensi bawaan Firebase Auth
  }

  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch (signInErr) {
    const code =
      typeof signInErr === 'object' && signInErr !== null && 'code' in signInErr
        ? String((signInErr as { code?: unknown }).code || '')
        : '';

    const matchedDefault = DEFAULT_ROLE_ACCOUNTS.find(
      (acc) => acc.email === email && acc.password === password
    );

    // Auto-provision default role accounts on their very first login
    if (
      matchedDefault &&
      (code === 'auth/user-not-found' || code === 'auth/invalid-credential')
    ) {
      try {
        const created = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(created.user, { displayName: matchedDefault.displayName });
        return created;
      } catch (createErr) {
        const createCode =
          typeof createErr === 'object' && createErr !== null && 'code' in createErr
            ? String((createErr as { code?: unknown }).code || '')
            : '';
        if (createCode === 'auth/email-already-in-use') {
          throw signInErr;
        }
        throw createErr;
      }
    }

    throw signInErr;
  }
}

export async function requestPasswordReset(
  identifier: string
): Promise<{ mode: 'sent' | 'internal_account'; email: string }> {
  const trimmed = identifier.trim().toLowerCase();
  if (!trimmed) {
    throw new Error('Masukkan email perusahaan atau username akun Anda.');
  }

  // Akun internal berbasis username (tanpa email aktif perusahaan) dikelola oleh Admin IT
  if (!trimmed.includes('@') || trimmed.endsWith(`@${DEFAULT_LOGIN_DOMAIN}`)) {
    return {
      mode: 'internal_account',
      email: normalizeLoginIdentifier(trimmed),
    };
  }

  await sendPasswordResetEmail(auth, trimmed);
  return {
    mode: 'sent',
    email: trimmed,
  };
}

export async function provisionFirebaseUserWithSecondaryApp(params: {
  email: string;
  password: string;
  displayName: string;
}): Promise<{ uid: string; email: string; displayName: string }> {
  const appName = `user_provisioner_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const secondaryApp = initializeApp(firebaseConfig, appName);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(
      secondaryAuth,
      params.email,
      params.password
    );
    await updateProfile(cred.user, { displayName: params.displayName });
    const uid = cred.user.uid;
    await signOut(secondaryAuth);
    return {
      uid,
      email: params.email,
      displayName: params.displayName,
    };
  } finally {
    await deleteApp(secondaryApp).catch(() => {});
  }
}

export async function changeOwnPassword(params: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.email) {
    throw new Error('Sesi login tidak ditemukan. Silakan masuk ulang.');
  }
  if (isBootstrapAdminEmail(currentUser.email)) {
    throw new Error('Kredensial akun Super User tetap tidak dapat diubah dari dialog ini.');
  }
  if (!params.currentPassword) {
    throw new Error('Kata sandi saat ini wajib diisi.');
  }
  if (params.newPassword.length < 6) {
    throw new Error('Kata sandi baru minimal 6 karakter.');
  }
  const credential = EmailAuthProvider.credential(
    currentUser.email,
    params.currentPassword
  );
  await reauthenticateWithCredential(currentUser, credential);
  await updatePassword(currentUser, params.newPassword);
}

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;

export type OperationTypeValue = (typeof OperationType)[keyof typeof OperationType];

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationTypeValue;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationTypeValue,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export async function getFreshIdToken(fallback = ''): Promise<string> {
  if (auth.currentUser) {
    return auth.currentUser.getIdToken();
  }
  return fallback;
}

void testConnection();
