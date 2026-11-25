import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import multer from 'multer';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import {
  analyzeModuleImageWithAi,
  buildRetrievalQuery,
  checkPrePublishConflictsWithAi,
  conductHandoverInterview,
  detectSopConflictsWithAi,
  embedSopLogicalChunks,
  formatGeminiErrorMessage,
  generateGroundedSopAnswer,
  reviseSopWithFeedbackAi,
  streamGroundedSopAnswer,
  structureSopWithAi,
  summarizeVisualPdfAttachment,
  tryEmbedText,
} from './server/ai.ts';
import {
  buildAssetMaintenanceAiContext,
  isAssetMaintenanceQuery,
  type AssetMaintenanceAiContext,
} from './server/assetAiContext.ts';
import {
  buildErpCombinedAiContext,
  invalidateErpStockCache,
  isErpAnyQuery,
  queryErpAssetsData,
  queryErpEmployees,
  queryErpFinanceData,
  queryErpPurchasingData,
  queryErpSalesData,
  queryErpWarehouseStock,
  queryErpWarehousesMaster,
  testErpMysqlConnection,
  type ErpStockAiContext,
} from './server/erpMysql.ts';
import { invalidateErpSalesBiCache, queryErpSalesBiData } from './server/erpSalesBi.ts';
import {
  invalidateErpPurchasingBiCache,
  queryErpPurchasingBiData,
} from './server/erpPurchasingBi.ts';
import {
  invalidateErpInventoryBiCache,
  queryErpInventoryBiData,
} from './server/erpInventoryBi.ts';
import {
  invalidateErpProductionBiCache,
  queryErpProductionBiData,
} from './server/erpProductionBi.ts';
import {
  dispatchMultiChannelNotification,
  getNotificationGatewayStatus,
  type DispatchNotificationRequest,
} from './server/notificationDispatcher.ts';
import {
  fetchAccessibleApprovedChunks,
  fetchAccessibleAssetsAndMaintenance,
  fetchCallerUserProfile,
  getCachedAccessibleChunks,
  invalidateAssetCache,
  invalidateCallerProfileCache,
  invalidateChunkCache,
} from './server/firestoreRest.ts';
import {
  invalidatePendingTransactionsCache,
  queryErpPendingTransactions,
} from './server/erpPendingTransactions.ts';
import {
  invalidateErpUserAccessCache,
  queryErpUsersPurchasingAccess,
} from './server/erpUserAccess.ts';
import type { SopVisualCatalogEntry } from './src/lib/visualIntent.ts';
import type { CitationSource, Division, FeedbackType, SopDocument } from './src/types/sop.ts';
import {
  appendUserChatMessage,
  createUserChatSession,
  deleteUserChatSession,
  listUserChatMessages,
  listUserChatSessions,
  updateUserChatMessageFeedback,
  updateUserChatSession,
} from './server/chatHistoryStore.ts';
import {
  getAllowedAiDataScopes,
  hasAnyErpPendingNotifyPermission,
  hasMenuPermission,
  type AllowedAiDataScopes,
  type PermissionAction,
  type RolePermissionMatrix,
} from './src/config/menuRegistry.ts';
import {
  authenticateRbacUser,
  createRbacRole,
  createRbacUser,
  deleteRbacRole,
  deleteRbacUser,
  getMenuRegistryPayload,
  getPublicDemoDirectory,
  listRbacAuditLogs,
  listRbacRoles,
  listRbacUsers,
  resetRbacUserPassword,
  resolveRbacSessionByEmailOrUsername,
  resolveRbacSessionByUserId,
  updateRbacRole,
  updateRbacUser,
  verifyRbacToken,
  type RbacActorContext,
  type RbacRoleRecord,
  type SafeRbacUser,
} from './server/rbacStore.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAuth();

interface AuthRequest extends Request {
  user?: DecodedIdToken;
  idToken?: string;
  rbacUser?: SafeRbacUser;
  rbacRole?: RbacRoleRecord;
  rbacPermissions?: RolePermissionMatrix;
}

function getRbacActor(req: AuthRequest): RbacActorContext {
  return {
    id: req.rbacUser?.id ?? req.user?.uid ?? 'unknown',
    username: req.rbacUser?.username ?? req.user?.email ?? 'unknown',
    fullName: req.rbacUser?.fullName ?? req.user?.name ?? req.user?.email ?? 'User',
    roleCode: req.rbacRole?.code ?? 'STAFF',
  };
}

function buildAllowedScopeLabels(scopes: AllowedAiDataScopes): string[] {
  const labels: string[] = [];
  if (scopes.sop) labels.push('SOP & Prosedur Perusahaan');
  if (scopes.assetsMaintenance) labels.push('Inventaris Aset & Jadwal Maintenance');
  if (scopes.stock) labels.push('Stok Gudang (Inventory)');
  if (scopes.purchasing && scopes.purchasingPayment) {
    labels.push('Pembelian, Supplier, Hutang & Pembayaran (Purchasing)');
  } else if (scopes.purchasing) {
    labels.push('Pembelian Operasional PR/PO/GRN (tanpa data Pembayaran/Hutang)');
  }
  if (scopes.sales) labels.push('Penjualan & Customer (Sales)');
  if (scopes.finance) labels.push('Keuangan, Laba Rugi, Neraca & Kas/Bank (Finance)');
  if (scopes.erpAssets) labels.push('Aset Tetap ERP & Penyusutan');
  return labels;
}

const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const rbacHeader =
    typeof req.headers['x-rbac-token'] === 'string' ? req.headers['x-rbac-token'].trim() : '';

  const bearerToken =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';

  const rbacToken = rbacHeader || (bearerToken.startsWith('rbac_') ? bearerToken : '');
  const firebaseToken = bearerToken && !bearerToken.startsWith('rbac_') ? bearerToken : '';

  if (!rbacToken && !firebaseToken) {
    res.status(401).json({ error: 'Autentikasi diperlukan (token tidak ditemukan).' });
    return;
  }

  try {
    // 1. Verify Firebase ID Token if provided (used for Firestore REST reads)
    if (firebaseToken) {
      try {
        const decoded = await adminAuth.verifyIdToken(firebaseToken);
        req.user = decoded;
        req.idToken = firebaseToken;
      } catch (fbErr) {
        if (!rbacToken) {
          console.error('Firebase token verification error:', fbErr);
          res.status(401).json({ error: 'Sesi login tidak valid atau telah kedaluwarsa.' });
          return;
        }
      }
    }

    // 2. Authoritative RBAC resolution (always checks live isActive + current Role permissions)
    if (rbacToken) {
      const payload = verifyRbacToken(rbacToken);
      if (!payload) {
        res.status(401).json({ error: 'Sesi RBAC tidak valid atau telah kedaluwarsa. Silakan login kembali.' });
        return;
      }
      const resolved = resolveRbacSessionByUserId(payload.uid);
      if (!resolved) {
        res.status(403).json({
          error: 'Akun Anda tidak aktif atau tidak ditemukan. Hubungi Administrator.',
        });
        return;
      }
      req.rbacUser = resolved.user;
      req.rbacRole = resolved.role;
      req.rbacPermissions = resolved.permissions;
      next();
      return;
    }

    // 3. Fallback: resolve RBAC profile from verified Firebase token email
    const resolvedFromFb = resolveRbacSessionByEmailOrUsername(req.user?.email);
    if (!resolvedFromFb) {
      res.status(403).json({
        error: 'Akun Anda sedang nonaktif atau belum memiliki role yang valid.',
      });
      return;
    }
    req.rbacUser = resolvedFromFb.user;
    req.rbacRole = resolvedFromFb.role;
    req.rbacPermissions = resolvedFromFb.permissions;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(401).json({ error: 'Sesi login tidak valid atau telah kedaluwarsa.' });
  }
};

const requireMenuAccess =
  (menuIds: string | string[], action: PermissionAction = 'view') =>
  (req: AuthRequest, res: Response, next: NextFunction) => {
    const ids = Array.isArray(menuIds) ? menuIds : [menuIds];
    const allowed = ids.some((id) => hasMenuPermission(req.rbacPermissions, id, action));
    if (!allowed) {
      res.status(403).json({
        error: 'Anda tidak memiliki akses',
        code: 'FORBIDDEN_ROLE_ACCESS',
        requiredMenu: ids,
        requiredAction: action,
      });
      return;
    }
    next();
  };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 45 * 1024 * 1024 },
});

async function extractTextFromUploadedFile(file: Express.Multer.File): Promise<{
  rawText?: string;
  fileBase64?: string;
  mimeType?: string;
  extractedPreview: string;
}> {
  const lowerName = file.originalname.toLowerCase();
  const mime = file.mimetype || '';

  if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) {
    return {
      fileBase64: file.buffer.toString('base64'),
      mimeType: 'application/pdf',
      extractedPreview: `Dokumen PDF (${file.originalname}, ${(file.size / 1024).toFixed(1)} KB)`,
    };
  }

  if (
    lowerName.endsWith('.docx') ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    const text = (result.value || '').trim();
    return {
      rawText: text,
      extractedPreview: text.slice(0, 3500),
    };
  }

  if (
    lowerName.endsWith('.xlsx') ||
    lowerName.endsWith('.xls') ||
    lowerName.endsWith('.csv') ||
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime === 'text/csv'
  ) {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetTexts = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      return `=== Sheet: ${name} ===\n${csv}`;
    });
    const combined = sheetTexts.join('\n\n').trim();
    return {
      rawText: combined,
      extractedPreview: combined.slice(0, 3500),
    };
  }

  let utf8Text: string;
  if (file.buffer.length >= 2 && file.buffer[0] === 0xff && file.buffer[1] === 0xfe) {
    utf8Text = file.buffer.subarray(2).toString('utf16le');
  } else if (file.buffer.length >= 2 && file.buffer[0] === 0xfe && file.buffer[1] === 0xff) {
    const swapped = Buffer.alloc(file.buffer.length - 2);
    for (let i = 2; i + 1 < file.buffer.length; i += 2) {
      swapped[i - 2] = file.buffer[i + 1];
      swapped[i - 1] = file.buffer[i];
    }
    utf8Text = swapped.toString('utf16le');
  } else {
    utf8Text = file.buffer.toString('utf-8').replace(/^\uFEFF/, '');
  }
  const cleanedText = utf8Text.replace(/\u0000/g, '').trim();
  return {
    rawText: cleanedText,
    extractedPreview: cleanedText.slice(0, 3500),
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '45mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'sop-brain' });
  });

  // ===================== RBAC: AUTHENTICATION, USER LOGIN & USER ROLE APIs =====================

  app.post('/api/rbac/login', (req: Request, res: Response) => {
    const { identifier, password } = (req.body || {}) as {
      identifier?: string;
      password?: string;
    };
    const result = authenticateRbacUser(String(identifier || ''), String(password || ''));
    if ('error' in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({
      token: result.token,
      user: result.user,
      role: result.role,
      permissions: result.permissions,
      registry: getMenuRegistryPayload(),
    });
  });

  app.get('/api/rbac/demo-accounts', (_req: Request, res: Response) => {
    res.json({ accounts: getPublicDemoDirectory() });
  });

  app.get('/api/rbac/me', requireAuth, (req: AuthRequest, res: Response) => {
    res.json({
      user: req.rbacUser,
      role: req.rbacRole,
      permissions: req.rbacPermissions,
      registry: getMenuRegistryPayload(),
    });
  });

  app.get(
    '/api/rbac/roles',
    requireAuth,
    requireMenuAccess(['user_role', 'user_login'], 'view'),
    (_req: AuthRequest, res: Response) => {
      res.json({
        roles: listRbacRoles(),
        registry: getMenuRegistryPayload(),
      });
    }
  );

  app.post(
    '/api/rbac/roles',
    requireAuth,
    requireMenuAccess('user_role', 'insert'),
    (req: AuthRequest, res: Response) => {
      const body = (req.body || {}) as {
        code?: string;
        name?: string;
        description?: string;
        permissions?: Partial<RolePermissionMatrix>;
      };
      const result = createRbacRole(
        {
          code: String(body.code || ''),
          name: String(body.name || ''),
          description: typeof body.description === 'string' ? body.description : '',
          permissions: body.permissions,
        },
        getRbacActor(req)
      );
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(201).json(result);
    }
  );

  app.put(
    '/api/rbac/roles/:id',
    requireAuth,
    requireMenuAccess('user_role', 'update'),
    (req: AuthRequest, res: Response) => {
      const body = (req.body || {}) as {
        code?: string;
        name?: string;
        description?: string;
        permissions?: Partial<RolePermissionMatrix>;
      };
      const result = updateRbacRole(
        req.params.id,
        {
          code: body.code,
          name: body.name,
          description: body.description,
          permissions: body.permissions,
        },
        getRbacActor(req)
      );
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    }
  );

  app.delete(
    '/api/rbac/roles/:id',
    requireAuth,
    requireMenuAccess('user_role', 'delete'),
    (req: AuthRequest, res: Response) => {
      const result = deleteRbacRole(req.params.id, getRbacActor(req));
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    }
  );

  app.get(
    '/api/rbac/users',
    requireAuth,
    requireMenuAccess('user_login', 'view'),
    (_req: AuthRequest, res: Response) => {
      res.json({ users: listRbacUsers() });
    }
  );

  app.post(
    '/api/rbac/users',
    requireAuth,
    requireMenuAccess('user_login', 'insert'),
    (req: AuthRequest, res: Response) => {
      const body = (req.body || {}) as {
        username?: string;
        fullName?: string;
        email?: string;
        roleId?: string;
        divisionId?: string;
        divisionName?: string;
        password?: string;
        isActive?: boolean;
      };
      const result = createRbacUser(
        {
          username: String(body.username || ''),
          fullName: String(body.fullName || ''),
          email: String(body.email || ''),
          roleId: String(body.roleId || ''),
          divisionId: body.divisionId ? String(body.divisionId) : undefined,
          divisionName: body.divisionName ? String(body.divisionName) : undefined,
          password: String(body.password || ''),
          isActive: body.isActive,
        },
        getRbacActor(req)
      );
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(201).json(result);
    }
  );

  app.put(
    '/api/rbac/users/:id',
    requireAuth,
    requireMenuAccess('user_login', 'update'),
    (req: AuthRequest, res: Response) => {
      const body = (req.body || {}) as {
        username?: string;
        fullName?: string;
        email?: string;
        roleId?: string;
        divisionId?: string;
        divisionName?: string;
        isActive?: boolean;
      };
      const result = updateRbacUser(req.params.id, body, getRbacActor(req));
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    }
  );

  app.patch(
    '/api/rbac/users/:id/status',
    requireAuth,
    requireMenuAccess('user_login', 'update'),
    (req: AuthRequest, res: Response) => {
      const body = (req.body || {}) as { isActive?: boolean };
      const result = updateRbacUser(
        req.params.id,
        { isActive: Boolean(body.isActive) },
        getRbacActor(req)
      );
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    }
  );

  app.post(
    '/api/rbac/users/:id/reset-password',
    requireAuth,
    requireMenuAccess('user_login', 'update'),
    (req: AuthRequest, res: Response) => {
      const body = (req.body || {}) as { newPassword?: string };
      const result = resetRbacUserPassword(
        req.params.id,
        String(body.newPassword || ''),
        getRbacActor(req)
      );
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    }
  );

  app.delete(
    '/api/rbac/users/:id',
    requireAuth,
    requireMenuAccess('user_login', 'delete'),
    (req: AuthRequest, res: Response) => {
      const result = deleteRbacUser(req.params.id, getRbacActor(req));
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    }
  );

  app.get(
    '/api/rbac/audit-logs',
    requireAuth,
    requireMenuAccess(['admin_audit', 'user_role', 'user_login'], 'view'),
    (req: AuthRequest, res: Response) => {
      const limit = Number(req.query.limit) || 150;
      res.json({ logs: listRbacAuditLogs(limit) });
    }
  );

  // ---------------------------------------------------------------------------
  // Per-User Isolated AI Chat History Endpoints (strictly scoped to req.rbacUser.id)
  // ---------------------------------------------------------------------------
  const getChatOwnerId = (req: AuthRequest): string =>
    String(req.rbacUser?.id || req.user?.uid || '').trim();

  app.get(
    '/api/chat-sessions',
    requireAuth,
    requireMenuAccess('ask_ai', 'view'),
    (req: AuthRequest, res: Response) => {
      const ownerId = getChatOwnerId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Identitas pengguna tidak ditemukan.' });
        return;
      }
      const sessions = listUserChatSessions(ownerId, 50);
      res.json({ sessions });
    }
  );

  app.post(
    '/api/chat-sessions',
    requireAuth,
    requireMenuAccess('ask_ai', 'view'),
    (req: AuthRequest, res: Response) => {
      const ownerId = getChatOwnerId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Identitas pengguna tidak ditemukan.' });
        return;
      }
      const body = (req.body || {}) as { title?: string };
      const session = createUserChatSession({
        ownerUserId: ownerId,
        userName: req.rbacUser?.fullName || req.user?.name || req.user?.email || 'User',
        divisionId: req.rbacUser?.divisionId || req.rbacRole?.code?.toLowerCase() || '',
        title: String(body.title || 'Percakapan Baru'),
      });
      res.status(201).json({ session });
    }
  );

  app.patch(
    '/api/chat-sessions/:sessionId',
    requireAuth,
    requireMenuAccess('ask_ai', 'view'),
    (req: AuthRequest, res: Response) => {
      const ownerId = getChatOwnerId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Identitas pengguna tidak ditemukan.' });
        return;
      }
      const body = (req.body || {}) as { title?: string; isPinned?: boolean };
      const result = updateUserChatSession(ownerId, req.params.sessionId, {
        title: typeof body.title === 'string' ? body.title : undefined,
        isPinned: typeof body.isPinned === 'boolean' ? body.isPinned : undefined,
      });
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({ session: result.session });
    }
  );

  app.delete(
    '/api/chat-sessions/:sessionId',
    requireAuth,
    requireMenuAccess('ask_ai', 'view'),
    (req: AuthRequest, res: Response) => {
      const ownerId = getChatOwnerId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Identitas pengguna tidak ditemukan.' });
        return;
      }
      const result = deleteUserChatSession(ownerId, req.params.sessionId);
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json(result);
    }
  );

  app.get(
    '/api/chat-sessions/:sessionId/messages',
    requireAuth,
    requireMenuAccess('ask_ai', 'view'),
    (req: AuthRequest, res: Response) => {
      const ownerId = getChatOwnerId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Identitas pengguna tidak ditemukan.' });
        return;
      }
      const result = listUserChatMessages(ownerId, req.params.sessionId);
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({ messages: result.messages });
    }
  );

  app.post(
    '/api/chat-sessions/:sessionId/messages',
    requireAuth,
    requireMenuAccess('ask_ai', 'view'),
    (req: AuthRequest, res: Response) => {
      const ownerId = getChatOwnerId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Identitas pengguna tidak ditemukan.' });
        return;
      }
      const body = (req.body || {}) as {
        role?: 'user' | 'assistant';
        content?: string;
        citations?: CitationSource[];
        hasConflict?: boolean;
        answered?: boolean;
        suggestedContact?: string;
        logId?: string;
      };
      const result = appendUserChatMessage(ownerId, req.params.sessionId, {
        role: body.role === 'assistant' ? 'assistant' : 'user',
        content: String(body.content || ''),
        citations: body.citations,
        hasConflict: body.hasConflict,
        answered: body.answered,
        suggestedContact: body.suggestedContact,
        logId: body.logId,
      });
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.status(201).json({ message: result.message });
    }
  );

  app.patch(
    '/api/chat-sessions/:sessionId/messages/:messageId/feedback',
    requireAuth,
    requireMenuAccess('ask_ai', 'view'),
    (req: AuthRequest, res: Response) => {
      const ownerId = getChatOwnerId(req);
      if (!ownerId) {
        res.status(401).json({ error: 'Identitas pengguna tidak ditemukan.' });
        return;
      }
      const body = (req.body || {}) as { feedback?: FeedbackType; feedbackNote?: string };
      const result = updateUserChatMessageFeedback(
        ownerId,
        req.params.sessionId,
        req.params.messageId,
        (body.feedback || 'none') as FeedbackType,
        String(body.feedbackNote || '')
      );
      if ('error' in result) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({ message: result.message });
    }
  );

  // Generate logical chunks + Gemini embeddings for an approved SOP
  app.post('/api/sop/embed', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { sop } = req.body as { sop?: SopDocument };
      if (!sop || !sop.id || !sop.title) {
        res.status(400).json({ error: 'Data SOP tidak lengkap untuk proses pengindeksan.' });
        return;
      }
      const chunks = await embedSopLogicalChunks(sop);
      invalidateChunkCache();
      res.json({ chunks });
    } catch (err) {
      console.error('Error embedding SOP chunks:', err);
      const message = formatGeminiErrorMessage(err, 'Gagal membuat embedding SOP.');
      res.status(500).json({ error: message });
    }
  });

  // Pre-warm user's accessible SOP chunk cache when entering Q&A view
  app.post('/api/rag/warm', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      if (!req.user || !req.idToken) {
        res.status(401).json({ error: 'Token pengguna tidak ditemukan.' });
        return;
      }
      const chunks = await fetchAccessibleApprovedChunks({
        idToken: req.idToken,
        uid: req.user.uid,
        email: req.user.email,
      });
      res.json({ ok: true, count: chunks.length });
    } catch (err) {
      console.warn('Chunk warmup warning:', err);
      res.json({ ok: false });
    }
  });

  // Clear cached RAG chunks when SOPs or user permissions change
  app.post('/api/rag/invalidate-cache', requireAuth, (_req: AuthRequest, res: Response) => {
    invalidateChunkCache();
    res.json({ ok: true });
  });

  // Clear cached asset & maintenance context when records are created/updated/deleted
  app.post('/api/assets/invalidate-cache', requireAuth, (_req: AuthRequest, res: Response) => {
    invalidateAssetCache();
    res.json({ ok: true });
  });

  // External ERP MySQL (Read-Only) connection status & diagnostics
  app.get('/api/erp/status', requireAuth, async (_req: AuthRequest, res: Response) => {
    try {
      const status = await testErpMysqlConnection();
      res.json(status);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal memeriksa koneksi MySQL ERP.';
      res.status(500).json({ configured: true, connected: false, error: message });
    }
  });

  // External ERP MySQL (Read-Only) warehouse stock lookup (active inventory baktif = 1, bjenis = 'P' + category + qtySort)
  app.get(
    '/api/erp/stock',
    requireAuth,
    requireMenuAccess(['erp_inventory', 'erp_bi_inventory'], 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const search = typeof req.query.q === 'string' ? req.query.q : '';
      const warehouse = typeof req.query.warehouse === 'string' ? req.query.warehouse : '';
      const category = typeof req.query.category === 'string' ? req.query.category : '';
      const onlyLowStock = req.query.low === '1' || req.query.low === 'true';
      const summaryOnly = req.query.summaryOnly === '1' || req.query.summaryOnly === 'true';
      const intransitOnly =
        req.query.intransitOnly === '1' || req.query.intransitOnly === 'true';
      const rawSort = typeof req.query.qtySort === 'string' ? req.query.qtySort.trim().toLowerCase() : '';
      const qtySort: 'asc' | 'desc' | '' = rawSort === 'asc' || rawSort === 'desc' ? rawSort : '';
      const bypassCache = req.query.refresh === '1';
      const limit = Number(req.query.limit) || 100;

      const data = await queryErpWarehouseStock({
        search,
        warehouse,
        category,
        onlyLowStock,
        summaryOnly,
        intransitOnly,
        qtySort,
        limit,
        bypassCache,
      });
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal mengambil data stok gudang dari MySQL ERP.';
      res.status(500).json({ error: message });
    }
  });

  // External ERP MySQL (Read-Only) master warehouse list (m1_warehouse + stock aggregates)
  app.get(
    '/api/erp/warehouses',
    requireAuth,
    requireMenuAccess(['erp_inventory', 'erp_bi_inventory'], 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const bypassCache = req.query.refresh === '1';
      const data = await queryErpWarehousesMaster({ bypassCache });
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal mengambil daftar master gudang dari MySQL ERP.';
      res.status(500).json({ error: message });
    }
  });

  // External ERP MySQL (Read-Only) Sales module (m5_si, m5_so, m5_do, m5_sr + m1_contact)
  app.get(
    '/api/erp/sales',
    requireAuth,
    requireMenuAccess(['erp_sales', 'erp_bi_sales'], 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const search = typeof req.query.q === 'string' ? req.query.q : '';
      const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '';
      const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : '';
      const bypassCache = req.query.refresh === '1';
      const limit = Number(req.query.limit) || 35;

      const data = await queryErpSalesData({
        search,
        dateFrom,
        dateTo,
        limit,
        bypassCache,
      });
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal mengambil data penjualan (m5) dari MySQL ERP.';
      res.status(500).json({ error: message });
    }
  });

  // External ERP MySQL (Read-Only) Business Intelligence Sales KPIs (m5_so, m5_do, m5_si, m5_sr + m1_contact + m1_item)
  app.get(
    '/api/erp/sales-bi',
    requireAuth,
    requireMenuAccess('erp_bi_sales', 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '';
      const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : '';
      const bypassCache = req.query.refresh === '1';

      const data = await queryErpSalesBiData({
        dateFrom,
        dateTo,
        bypassCache,
      });
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Gagal mengambil data Business Intelligence Sales (m5) dari MySQL ERP.';
      res.status(500).json({ error: message });
    }
  });

  // External ERP MySQL (Read-Only) Business Intelligence Purchasing KPIs (m4_pr/po/grn/ri/prt/vp + m1_contact + m2_transaction_journal)
  app.get(
    '/api/erp/purchasing-bi',
    requireAuth,
    requireMenuAccess('erp_bi_purchasing', 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '';
      const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : '';
      const bypassCache = req.query.refresh === '1';

      const data = await queryErpPurchasingBiData({
        dateFrom,
        dateTo,
        bypassCache,
      });
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Gagal mengambil data Business Intelligence Purchasing (m4) dari MySQL ERP.';
      res.status(500).json({ error: message });
    }
  });

  // External ERP MySQL (Read-Only) Business Intelligence Inventory KPIs (m1_item/warehouse/stock + m4_grn + m5_do/si + GL, strict Intransit exclusion)
  app.get(
    '/api/erp/inventory-bi',
    requireAuth,
    requireMenuAccess('erp_bi_inventory', 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '';
      const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : '';
      const bypassCache = req.query.refresh === '1';

      const data = await queryErpInventoryBiData({
        dateFrom,
        dateTo,
        bypassCache,
      });
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Gagal mengambil data Business Intelligence Inventory (m1) dari MySQL ERP.';
      res.status(500).json({ error: message });
    }
  });

  // External ERP MySQL (Read-Only) Business Intelligence Production KPIs (schema-adaptive m6_* discovery + GL production costs)
  app.get(
    '/api/erp/production-bi',
    requireAuth,
    requireMenuAccess('erp_bi_production', 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '';
      const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : '';
      const bypassCache = req.query.refresh === '1';

      const data = await queryErpProductionBiData({
        dateFrom,
        dateTo,
        bypassCache,
      });
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Gagal mengambil data Business Intelligence Production (m6) dari MySQL ERP.';
      res.status(500).json({ error: message });
    }
  });

  // External ERP MySQL (Read-Only) Purchasing module (100% GL Laporan Keuangan + m4_ri/po/grn/pr/prt/vp)
  app.get(
    '/api/erp/purchasing',
    requireAuth,
    requireMenuAccess(['erp_purchasing', 'erp_bi_purchasing'], 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const search = typeof req.query.q === 'string' ? req.query.q : '';
      const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '';
      const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : '';
      const bypassCache = req.query.refresh === '1';
      const limit = Number(req.query.limit) || 35;

      const data = await queryErpPurchasingData({
        search,
        dateFrom,
        dateTo,
        limit,
        bypassCache,
      });
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal mengambil data purchasing (m4) dari MySQL ERP.';
      res.status(500).json({ error: message });
    }
  });

  // External ERP MySQL (Read-Only) Finance module (m1_coa + m2_transaction_journal + m5_si Aging)
  app.get(
    '/api/erp/finance',
    requireAuth,
    requireMenuAccess(['erp_finance', 'erp_bi_finance'], 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const search = typeof req.query.q === 'string' ? req.query.q : '';
      const dateFrom = typeof req.query.dateFrom === 'string' ? req.query.dateFrom : '';
      const dateTo = typeof req.query.dateTo === 'string' ? req.query.dateTo : '';
      const bypassCache = req.query.refresh === '1';

      const data = await queryErpFinanceData({
        search,
        dateFrom,
        dateTo,
        bypassCache,
      });
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal mengambil data keuangan (m2) dari MySQL ERP.';
      res.status(500).json({ error: message });
    }
  });

  // External ERP MySQL (Read-Only) Fixed Assets module (m7_asset / m7_asset_v + m7_asset_depreciation)
  app.get(
    '/api/erp/assets',
    requireAuth,
    requireMenuAccess('erp_assets', 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const search = typeof req.query.q === 'string' ? req.query.q : '';
      const category = typeof req.query.category === 'string' ? req.query.category : '';
      const includeDisposed =
        req.query.includeDisposed === '1' || req.query.includeDisposed === 'true';
      const bypassCache = req.query.refresh === '1';
      const limit = Number(req.query.limit) || 500;

      const data = await queryErpAssetsData({
        search,
        category,
        includeDisposed,
        limit,
        bypassCache,
      });
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal mengambil data aset tetap (m7) dari MySQL ERP.';
      res.status(500).json({ error: message });
    }
  });

  // External ERP MySQL (Read-Only) Employee Master (m1_contact, category Employee)
  app.get('/api/erp/employees', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const search = typeof req.query.q === 'string' ? req.query.q : '';
      const onlyActive = req.query.onlyActive !== '0';
      const includeAll = req.query.includeAll === '1' || req.query.includeAll === 'true';
      const bypassCache = req.query.refresh === '1';
      const limit = Number(req.query.limit) || 500;

      const data = await queryErpEmployees({
        search,
        onlyActive,
        includeAll,
        limit,
        bypassCache,
      });
      res.json(data);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Gagal mengambil data master karyawan (m1_contact) dari MySQL ERP.';
      res.status(500).json({ error: message });
    }
  });

  // External ERP MySQL (Read-Only) Pending Transactions Summary — Routed strictly by User Role `Notif` checkboxes
  app.get(
    '/api/erp/pending-notifications',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const hasAnyNotify = hasAnyErpPendingNotifyPermission(req.rbacPermissions);

        if (!hasAnyNotify) {
          res.json({
            available: true,
            sourceMode: 'unavailable',
            cutoffDate: '2026-03-01',
            totalCount: 0,
            highestUrgency: null,
            byModule: {
              sales: { count: 0, oldestAgeDays: 0, highestUrgency: null },
              purchasing: { count: 0, oldestAgeDays: 0, highestUrgency: null },
            },
            rules: [],
            allowedRuleIds: [],
            callerScope: {
              role: req.rbacRole?.isSystemAdmin ? 'Super Admin' : 'Karyawan',
              divisionName: req.rbacUser?.divisionName || req.rbacRole?.name || '',
            },
            fetchedAt: new Date().toISOString(),
            cached: false,
          });
          return;
        }

        const bypassCache = req.query.refresh === '1';
        const summary = await queryErpPendingTransactions({
          caller: {
            role: req.rbacRole?.isSystemAdmin ? 'Super Admin' : 'Karyawan',
            divisionName: req.rbacUser?.divisionName || req.rbacRole?.name || '',
            rbacPermissions: req.rbacPermissions ?? null,
            isSystemAdmin: Boolean(req.rbacRole?.isSystemAdmin),
          },
          bypassCache,
        });

        res.json(summary);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Gagal memuat ringkasan transaksi tertunda dari ERP.';
        res.status(500).json({ error: message });
      }
    }
  );

  // External ERP MySQL (Read-Only) User & Purchasing Menu Access Matrix (m0_user + m0_role_menu) — Role guarded
  app.get(
    '/api/erp/users-access',
    requireAuth,
    requireMenuAccess(['user_login', 'user_role'], 'view'),
    async (req: AuthRequest, res: Response) => {
      try {
        const bypassCache = req.query.refresh === '1';
        const data = await queryErpUsersPurchasingAccess({ bypassCache });
        res.json(data);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Gagal mengambil daftar akun & hak akses menu ERP (m0_user / m0_role_menu).';
        res.status(500).json({ error: message });
      }
    }
  );

  // Server-side Notification Gateway Status (never exposes secrets)
  app.get('/api/notifications/status', requireAuth, (_req: AuthRequest, res: Response) => {
    res.json(getNotificationGatewayStatus());
  });

  // Multi-Channel Notification Dispatch (Email via SMTP/Resend + WhatsApp via Fonnte/Meta Cloud API)
  app.post(
    '/api/notifications/send',
    requireAuth,
    requireMenuAccess('notifications_send', 'insert'),
    async (req: AuthRequest, res: Response) => {
    try {
      const body = (req.body || {}) as Partial<DispatchNotificationRequest>;
      const allowedCategories = new Set(['maintenance', 'meeting', 'sop_review', 'general']);
      const allowedPriorities = new Set(['normal', 'warning', 'urgent']);

      const category =
        typeof body.category === 'string' && allowedCategories.has(body.category)
          ? (body.category as DispatchNotificationRequest['category'])
          : 'general';
      const priority =
        typeof body.priority === 'string' && allowedPriorities.has(body.priority)
          ? (body.priority as DispatchNotificationRequest['priority'])
          : 'normal';
      const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
      const message = typeof body.message === 'string' ? body.message.trim() : '';

      if (!subject || !message) {
        res.status(400).json({ error: 'Judul dan pesan notifikasi wajib diisi.' });
        return;
      }

      const rawRecipients = Array.isArray(body.recipients) ? body.recipients : [];
      if (rawRecipients.length === 0) {
        res.status(400).json({ error: 'Pilih minimal satu penerima notifikasi.' });
        return;
      }

      const senderName =
        (typeof body.senderName === 'string' && body.senderName.trim()) ||
        req.user?.name ||
        req.user?.email ||
        'Administrator';

      const result = await dispatchMultiChannelNotification({
        category,
        priority,
        subject,
        message,
        channels: {
          email: Boolean(body.channels?.email),
          whatsapp: Boolean(body.channels?.whatsapp),
        },
        recipients: rawRecipients.slice(0, 50).map((r) => ({
          uid: typeof r?.uid === 'string' ? r.uid : '',
          name: typeof r?.name === 'string' ? r.name : 'Karyawan',
          email: typeof r?.email === 'string' ? r.email : '',
          phone: typeof r?.phone === 'string' ? r.phone : '',
          erpCode: typeof r?.erpCode === 'string' ? r.erpCode : '',
        })),
        senderName,
      });

      res.json(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal mengirim notifikasi ke penerima.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/erp/refresh', requireAuth, (_req: AuthRequest, res: Response) => {
    invalidateErpStockCache();
    invalidateErpSalesBiCache();
    invalidateErpPurchasingBiCache();
    invalidateErpInventoryBiCache();
    invalidateErpProductionBiCache();
    invalidateErpUserAccessCache();
    invalidatePendingTransactionsCache();
    invalidateCallerProfileCache();
    res.json({ ok: true });
  });

  // Streaming Grounded Hybrid RAG Q&A (SSE) with server-enforced RBAC data gating
  app.post(
    '/api/rag/ask-stream',
    requireAuth,
    requireMenuAccess('ask_ai', 'view'),
    async (req: AuthRequest, res: Response) => {
      try {
        const { question, history, divisions, visualCatalog } = req.body as {
          question?: string;
          history?: { role: 'user' | 'assistant'; content: string }[];
          divisions?: Division[];
          visualCatalog?: SopVisualCatalogEntry[];
        };

        if (!question || !question.trim()) {
          res.status(400).json({ error: 'Pertanyaan tidak boleh kosong.' });
          return;
        }

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        let closed = false;
        req.on('close', () => {
          closed = true;
        });

        const sendEvent = (payload: Record<string, unknown>) => {
          if (closed) return;
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        };

        const safeQuestion = question.trim();
        const safeHistory = Array.isArray(history) ? history : [];
        const safeDivisions = Array.isArray(divisions) ? divisions : [];

        // STRICT SERVER-SIDE ROLE DATA SCOPES (derived from verified RBAC role, never client)
        const allowedScopes = getAllowedAiDataScopes(req.rbacPermissions);
        const deniedDomains: string[] = [];

        const hasFirebaseToken = Boolean(req.user && req.idToken);
        const cachedChunks =
          allowedScopes.sop && hasFirebaseToken
            ? getCachedAccessibleChunks(req.user!.uid, req.user!.email)
            : [];

        const wantsErpStockContext = isErpAnyQuery(safeQuestion, safeHistory);
        const explicitlyAsksMaintenance =
          /\b(servis|service|oli|ganti\s*oli|stnk|kir|uji\s*kir|jadwal|maintenance|perawatan|pemeliharaan|odometer|kilometer|\bkm\b|asuransi|plat\s*nomor|nopol|apar|genset|\bac\b)\b/i.test(
            safeQuestion
          );
        const explicitlyAsksSopPolicy =
          /\b(sop|prosedur|kebijakan|aturan|langkah|alur|instruksi|formulir|form|syarat|ketentuan|dokumen|manual|panduan|pic|penanggung\s*jawab|otorisasi|approval|persetujuan|tender|pembanding)\b/i.test(
            safeQuestion
          );
        const wantsAssetContextRaw =
          isAssetMaintenanceQuery(safeQuestion, safeHistory) &&
          (!wantsErpStockContext || explicitlyAsksMaintenance);

        const wantsAssetContext = wantsAssetContextRaw && allowedScopes.assetsMaintenance;
        if (wantsAssetContextRaw && !allowedScopes.assetsMaintenance) {
          deniedDomains.push('Inventaris Aset & Jadwal Maintenance');
        }

        const isPureErpDataQuery =
          wantsErpStockContext && !explicitlyAsksSopPolicy && allowedScopes.askAiErp;

        sendEvent({
          type: 'status',
          text:
            wantsErpStockContext && allowedScopes.askAiErp
              ? 'Memeriksa hak akses & mengambil data live ERP...'
              : wantsAssetContext
                ? 'Mengambil data aset & jadwal maintenance...'
                : 'Menelusuri SOP yang relevan...',
        });

        const assetContextPromise: Promise<AssetMaintenanceAiContext | undefined> =
          wantsAssetContext && hasFirebaseToken
            ? fetchAccessibleAssetsAndMaintenance({
                idToken: req.idToken!,
                uid: req.user!.uid,
                email: req.user!.email,
              })
                .then(({ assets, schedules }) => buildAssetMaintenanceAiContext(assets, schedules))
                .catch((assetErr) => {
                  console.warn('Asset & maintenance context fetch warning:', assetErr);
                  return undefined;
                })
            : Promise.resolve(undefined);

        const erpStockContextPromise: Promise<ErpStockAiContext | undefined> = wantsErpStockContext
          ? buildErpCombinedAiContext(safeQuestion, safeHistory, allowedScopes).catch((erpErr) => {
              console.warn('ERP MySQL live context fetch warning:', erpErr);
              return undefined;
            })
          : Promise.resolve(undefined);

        let accessibleChunks: Awaited<ReturnType<typeof fetchAccessibleApprovedChunks>> = [];
        let precomputedEmbedding: number[] | undefined;
        let assetMaintenanceContext: AssetMaintenanceAiContext | undefined;
        let erpStockContext: ErpStockAiContext | undefined;

        if (!allowedScopes.sop || !hasFirebaseToken) {
          accessibleChunks = [];
          [assetMaintenanceContext, erpStockContext] = await Promise.all([
            assetContextPromise,
            erpStockContextPromise,
          ]);
        } else if (cachedChunks && cachedChunks.length === 0) {
          accessibleChunks = cachedChunks;
          [assetMaintenanceContext, erpStockContext] = await Promise.all([
            assetContextPromise,
            erpStockContextPromise,
          ]);
        } else {
          const retrievalQuery = buildRetrievalQuery(safeQuestion, safeHistory);
          const [chunksResult, embeddingResult, assetCtxResult, erpCtxResult] = await Promise.all([
            cachedChunks
              ? Promise.resolve(cachedChunks)
              : isPureErpDataQuery
                ? Promise.resolve([])
                : fetchAccessibleApprovedChunks({
                    idToken: req.idToken!,
                    uid: req.user!.uid,
                    email: req.user!.email,
                  }),
            isPureErpDataQuery
              ? Promise.resolve(undefined)
              : tryEmbedText(retrievalQuery, true, 1200),
            assetContextPromise,
            erpStockContextPromise,
          ]);
          accessibleChunks = chunksResult;
          precomputedEmbedding = embeddingResult || [];
          assetMaintenanceContext = assetCtxResult;
          erpStockContext = erpCtxResult;
        }

        if (erpStockContext?.deniedDomains?.length) {
          deniedDomains.push(...erpStockContext.deniedDomains);
        }

        const uniqueDeniedDomains = Array.from(new Set(deniedDomains));
        const effectiveErpContext =
          erpStockContext && erpStockContext.summaryText ? erpStockContext : undefined;

        sendEvent({
          type: 'status',
          text: 'Menyusun jawaban AI...',
        });

        const result = await streamGroundedSopAnswer({
          question: safeQuestion,
          history: safeHistory,
          accessibleChunks,
          divisions: safeDivisions,
          precomputedEmbedding,
          visualCatalog: Array.isArray(visualCatalog) ? visualCatalog : undefined,
          assetMaintenanceContext,
          erpStockContext: effectiveErpContext,
          accessControlContext: {
            roleCode: req.rbacRole?.code ?? 'STAFF',
            roleName: req.rbacRole?.name ?? 'Karyawan Biasa',
            allowedScopeLabels: buildAllowedScopeLabels(allowedScopes),
            deniedDomains: uniqueDeniedDomains,
          },
          onDelta: (textChunk) => {
            sendEvent({ type: 'delta', text: textChunk });
          },
        });

        sendEvent({ type: 'done', result });
        if (!closed) res.end();
      } catch (err) {
        console.error('Error in /api/rag/ask-stream:', err);
        const message = formatGeminiErrorMessage(
          err,
          'Terjadi kesalahan saat memproses pertanyaan AI.'
        );
        if (!res.headersSent) {
          res.status(500).json({ error: message });
        } else if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify({ type: 'error', error: message })}\n\n`);
          res.end();
        }
      }
    }
  );

  // Grounded Hybrid RAG Q&A (JSON endpoint) with server-enforced RBAC data gating
  app.post(
    '/api/rag/ask',
    requireAuth,
    requireMenuAccess('ask_ai', 'view'),
    async (req: AuthRequest, res: Response) => {
      try {
        const { question, history, divisions, visualCatalog } = req.body as {
          question?: string;
          history?: { role: 'user' | 'assistant'; content: string }[];
          divisions?: Division[];
          visualCatalog?: SopVisualCatalogEntry[];
        };

        if (!question || !question.trim()) {
          res.status(400).json({ error: 'Pertanyaan tidak boleh kosong.' });
          return;
        }

        const safeQuestion = question.trim();
        const safeHistory = Array.isArray(history) ? history : [];
        const allowedScopes = getAllowedAiDataScopes(req.rbacPermissions);
        const deniedDomains: string[] = [];

        const hasFirebaseToken = Boolean(req.user && req.idToken);
        const cachedChunks =
          allowedScopes.sop && hasFirebaseToken
            ? getCachedAccessibleChunks(req.user!.uid, req.user!.email)
            : [];

        const wantsErpStockContext = isErpAnyQuery(safeQuestion, safeHistory);
        const explicitlyAsksMaintenance =
          /\b(servis|service|oli|ganti\s*oli|stnk|kir|uji\s*kir|jadwal|maintenance|perawatan|pemeliharaan|odometer|kilometer|\bkm\b|asuransi|plat\s*nomor|nopol|apar|genset|\bac\b)\b/i.test(
            safeQuestion
          );
        const explicitlyAsksSopPolicy =
          /\b(sop|prosedur|kebijakan|aturan|langkah|alur|instruksi|formulir|form|syarat|ketentuan|dokumen|manual|panduan|pic|penanggung\s*jawab|otorisasi|approval|persetujuan|tender|pembanding)\b/i.test(
            safeQuestion
          );
        const wantsAssetContextRaw =
          isAssetMaintenanceQuery(safeQuestion, safeHistory) &&
          (!wantsErpStockContext || explicitlyAsksMaintenance);
        const wantsAssetContext = wantsAssetContextRaw && allowedScopes.assetsMaintenance;
        if (wantsAssetContextRaw && !allowedScopes.assetsMaintenance) {
          deniedDomains.push('Inventaris Aset & Jadwal Maintenance');
        }

        const isPureErpDataQuery =
          wantsErpStockContext && !explicitlyAsksSopPolicy && allowedScopes.askAiErp;

        const assetContextPromise: Promise<AssetMaintenanceAiContext | undefined> =
          wantsAssetContext && hasFirebaseToken
            ? fetchAccessibleAssetsAndMaintenance({
                idToken: req.idToken!,
                uid: req.user!.uid,
                email: req.user!.email,
              })
                .then(({ assets, schedules }) => buildAssetMaintenanceAiContext(assets, schedules))
                .catch((assetErr) => {
                  console.warn('Asset & maintenance context fetch warning:', assetErr);
                  return undefined;
                })
            : Promise.resolve(undefined);

        const erpStockContextPromise: Promise<ErpStockAiContext | undefined> = wantsErpStockContext
          ? buildErpCombinedAiContext(safeQuestion, safeHistory, allowedScopes).catch((erpErr) => {
              console.warn('ERP MySQL live context fetch warning:', erpErr);
              return undefined;
            })
          : Promise.resolve(undefined);

        let accessibleChunks: Awaited<ReturnType<typeof fetchAccessibleApprovedChunks>> = [];
        let precomputedEmbedding: number[] | undefined;
        let assetMaintenanceContext: AssetMaintenanceAiContext | undefined;
        let erpStockContext: ErpStockAiContext | undefined;

        if (!allowedScopes.sop || !hasFirebaseToken) {
          accessibleChunks = [];
          [assetMaintenanceContext, erpStockContext] = await Promise.all([
            assetContextPromise,
            erpStockContextPromise,
          ]);
        } else if (cachedChunks && cachedChunks.length === 0) {
          accessibleChunks = cachedChunks;
          [assetMaintenanceContext, erpStockContext] = await Promise.all([
            assetContextPromise,
            erpStockContextPromise,
          ]);
        } else {
          const retrievalQuery = buildRetrievalQuery(safeQuestion, safeHistory);
          const [chunksResult, embeddingResult, assetCtxResult, erpCtxResult] = await Promise.all([
            cachedChunks
              ? Promise.resolve(cachedChunks)
              : isPureErpDataQuery
                ? Promise.resolve([])
                : fetchAccessibleApprovedChunks({
                    idToken: req.idToken!,
                    uid: req.user!.uid,
                    email: req.user!.email,
                  }),
            isPureErpDataQuery
              ? Promise.resolve(undefined)
              : tryEmbedText(retrievalQuery, true, 1200),
            assetContextPromise,
            erpStockContextPromise,
          ]);
          accessibleChunks = chunksResult;
          precomputedEmbedding = embeddingResult || [];
          assetMaintenanceContext = assetCtxResult;
          erpStockContext = erpCtxResult;
        }

        if (erpStockContext?.deniedDomains?.length) {
          deniedDomains.push(...erpStockContext.deniedDomains);
        }

        const uniqueDeniedDomains = Array.from(new Set(deniedDomains));
        const effectiveErpContext =
          erpStockContext && erpStockContext.summaryText ? erpStockContext : undefined;

        const result = await generateGroundedSopAnswer({
          question: safeQuestion,
          history: safeHistory,
          accessibleChunks,
          divisions: Array.isArray(divisions) ? divisions : [],
          precomputedEmbedding,
          visualCatalog: Array.isArray(visualCatalog) ? visualCatalog : undefined,
          assetMaintenanceContext,
          erpStockContext: effectiveErpContext,
          accessControlContext: {
            roleCode: req.rbacRole?.code ?? 'STAFF',
            roleName: req.rbacRole?.name ?? 'Karyawan Biasa',
            allowedScopeLabels: buildAllowedScopeLabels(allowedScopes),
            deniedDomains: uniqueDeniedDomains,
          },
        });

        res.json(result);
      } catch (err) {
        console.error('Error in /api/rag/ask:', err);
        const message = formatGeminiErrorMessage(
          err,
          'Terjadi kesalahan saat memproses pertanyaan AI.'
        );
        res.status(500).json({ error: message });
      }
    }
  );

  // AI Import: Parse PDF / Word / Excel / Text and structure into standard SOP format
  app.post(
    '/api/ai/import-sop',
    requireAuth,
    requireMenuAccess(['ai_studio_import', 'sop_manage'], 'view'),
    upload.single('file'),
    async (req: AuthRequest, res: Response) => {
    try {
      const file = req.file;
      let divisions: Division[] = [];
      if (typeof req.body?.divisions === 'string') {
        try {
          divisions = JSON.parse(req.body.divisions) as Division[];
        } catch {
          divisions = [];
        }
      }

      const titleHint = typeof req.body?.titleHint === 'string' ? req.body.titleHint : '';
      const divisionHint = typeof req.body?.divisionHint === 'string' ? req.body.divisionHint : '';
      const rawTextBody = typeof req.body?.rawText === 'string' ? req.body.rawText : '';
      const extractOnly = req.body?.extractOnly === 'true';

      if (!file && !rawTextBody.trim()) {
        res.status(400).json({ error: 'Unggah file (PDF, Word, Excel) atau masukkan teks dokumen.' });
        return;
      }

      if (file) {
        const extracted = await extractTextFromUploadedFile(file);
        if (!extracted.fileBase64 && (!extracted.rawText || !extracted.rawText.trim())) {
          res.status(400).json({ error: 'Isi file dokumen kosong atau tidak terbaca.' });
          return;
        }

        const attachmentInfo = {
          name: file.originalname,
          fileType: file.originalname.split('.').pop()?.toUpperCase() || 'FILE',
          sizeLabel: `${Math.max(1, Math.round(file.size / 1024))} KB`,
          extractedText: extracted.extractedPreview,
        };

        if (extractOnly) {
          if (!extracted.rawText && extracted.fileBase64 && extracted.mimeType === 'application/pdf') {
            const pdfSummary = await summarizeVisualPdfAttachment({
              fileBase64: extracted.fileBase64,
              mimeType: extracted.mimeType,
              fileName: file.originalname,
            });
            if (pdfSummary) {
              attachmentInfo.extractedText = pdfSummary;
            }
          }
          res.json({ draft: null, attachmentInfo });
          return;
        }

        const draft = await structureSopWithAi({
          rawText: extracted.rawText,
          fileBase64: extracted.fileBase64,
          mimeType: extracted.mimeType,
          fileName: file.originalname,
          titleHint,
          divisionHint,
          divisions,
        });

        // For image-rich PDFs without raw text extraction, store AI OCR/visual summary in attachmentInfo.extractedText
        if (extracted.mimeType === 'application/pdf') {
          const combinedSummary = [
            draft.attachmentSummary,
            draft.sections.map((s) => `${s.title}: ${s.content}`).join('\n'),
          ]
            .filter(Boolean)
            .join('\n\n')
            .trim();
          if (combinedSummary) {
            attachmentInfo.extractedText = combinedSummary.slice(0, 6000);
          }
        }

        res.json({
          draft,
          attachmentInfo,
        });
        return;
      }

      const draft = await structureSopWithAi({
        rawText: rawTextBody,
        titleHint,
        divisionHint,
        divisions,
      });
      res.json({ draft, attachmentInfo: null });
    } catch (err) {
      console.error('Error in /api/ai/import-sop:', err);
      const message = formatGeminiErrorMessage(err, 'Gagal mengekstrak SOP dari file.');
      res.status(500).json({ error: message });
    }
  });

  // AI SOP Writer: Turn rough notes or transcript into structured SOP
  app.post(
    '/api/ai/write-sop',
    requireAuth,
    requireMenuAccess(['ai_studio_writer', 'sop_manage'], 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const { notes, titleHint, divisionHint, divisions } = req.body as {
        notes?: string;
        titleHint?: string;
        divisionHint?: string;
        divisions?: Division[];
      };

      if (!notes || !notes.trim()) {
        res.status(400).json({ error: 'Catatan atau transkrip tidak boleh kosong.' });
        return;
      }

      const draft = await structureSopWithAi({
        rawText: notes.trim(),
        titleHint: titleHint || '',
        divisionHint: divisionHint || '',
        divisions: Array.isArray(divisions) ? divisions : [],
      });
      res.json({ draft });
    } catch (err) {
      console.error('Error in /api/ai/write-sop:', err);
      const message = formatGeminiErrorMessage(err, 'Gagal menyusun SOP dengan AI.');
      res.status(500).json({ error: message });
    }
  });

  // Fase 2: Proactive AI Conflict Detection across Approved SOPs
  app.post(
    '/api/ai/detect-conflicts',
    requireAuth,
    requireMenuAccess(['admin_analytics', 'sop_manage'], 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const { sops } = req.body as { sops?: SopDocument[] };
      if (!Array.isArray(sops)) {
        res.status(400).json({ error: 'Daftar SOP tidak valid.' });
        return;
      }
      const report = await detectSopConflictsWithAi(sops);
      res.json(report);
    } catch (err) {
      console.error('Error in /api/ai/detect-conflicts:', err);
      const message = formatGeminiErrorMessage(err, 'Gagal memindai konflik antar SOP.');
      res.status(500).json({ error: message });
    }
  });

  // Fase 3: AI Offboarding / Handover Knowledge Interview
  app.post(
    '/api/ai/handover-interview',
    requireAuth,
    requireMenuAccess(['ai_studio_writer', 'sop_manage'], 'view'),
    async (req: AuthRequest, res: Response) => {
    try {
      const { employeeRole, divisionName, topic, transcript } = req.body as {
        employeeRole?: string;
        divisionName?: string;
        topic?: string;
        transcript?: { speaker: 'ai' | 'user'; text: string }[];
      };

      if (!employeeRole?.trim() || !topic?.trim()) {
        res.status(400).json({ error: 'Peran karyawan dan topik pekerjaan wajib diisi.' });
        return;
      }

      const result = await conductHandoverInterview({
        employeeRole: employeeRole.trim(),
        divisionName: (divisionName || 'Umum').trim(),
        topic: topic.trim(),
        transcript: Array.isArray(transcript) ? transcript : [],
      });
      res.json(result);
    } catch (err) {
      console.error('Error in /api/ai/handover-interview:', err);
      const message = formatGeminiErrorMessage(err, 'Gagal menjalankan wawancara AI.');
      res.status(500).json({ error: message });
    }
  });

  // Feature #2: Vision Auto-OCR & Auto-Caption for uploaded module screenshots
  app.post('/api/ai/analyze-module-image', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { imageBase64, mimeType, moduleTitle, sopTitle, fileName } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        moduleTitle?: string;
        sopTitle?: string;
        fileName?: string;
      };
      if (!imageBase64 || !mimeType) {
        res.status(400).json({ error: 'Data gambar tidak lengkap untuk dianalisis.' });
        return;
      }
      const result = await analyzeModuleImageWithAi({
        imageBase64,
        mimeType,
        moduleTitle: moduleTitle || '',
        sopTitle: sopTitle || '',
        fileName: fileName || '',
      });
      res.json(result);
    } catch (err) {
      console.error('Error in /api/ai/analyze-module-image:', err);
      const message = formatGeminiErrorMessage(err, 'Gagal membaca isi gambar modul dengan AI.');
      res.status(500).json({ error: message });
    }
  });

  // Feature #1: Closed-loop AI SOP revision from negative employee feedback logs
  app.post('/api/ai/revise-sop-from-feedback', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { sop, feedbackItems } = req.body as {
        sop?: SopDocument;
        feedbackItems?: {
          question: string;
          feedback: string;
          feedbackNote: string;
          userName?: string;
        }[];
      };
      if (!sop || !sop.id || !Array.isArray(feedbackItems) || feedbackItems.length === 0) {
        res.status(400).json({ error: 'Data SOP dan umpan balik karyawan wajib disediakan.' });
        return;
      }
      const revision = await reviseSopWithFeedbackAi({ sop, feedbackItems });
      res.json({ revision });
    } catch (err) {
      console.error('Error in /api/ai/revise-sop-from-feedback:', err);
      const message = formatGeminiErrorMessage(
        err,
        'Gagal menyusun draf revisi SOP dari umpan balik.'
      );
      res.status(500).json({ error: message });
    }
  });

  // Feature #3: Pre-Publish Conflict & Duplication Guardrail before review/approval
  app.post('/api/ai/check-publish-conflicts', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const { candidateSop, existingApprovedSops } = req.body as {
        candidateSop?: SopDocument;
        existingApprovedSops?: SopDocument[];
      };
      if (!candidateSop || !candidateSop.title) {
        res.status(400).json({ error: 'Kandidat SOP tidak lengkap untuk pengecekan konflik.' });
        return;
      }
      const report = await checkPrePublishConflictsWithAi({
        candidateSop,
        existingApprovedSops: Array.isArray(existingApprovedSops) ? existingApprovedSops : [],
      });
      res.json(report);
    } catch (err) {
      console.error('Error in /api/ai/check-publish-conflicts:', err);
      const message = formatGeminiErrorMessage(err, 'Gagal memeriksa konflik pra-persetujuan.');
      res.status(500).json({ error: message });
    }
  });

  // Ensure /api/* routes never fall through to Vite/SPA HTML
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
  });

  // Ensure Multer / Express errors on API routes always return JSON
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/')) {
      const message =
        err instanceof multer.MulterError
          ? err.code === 'LIMIT_FILE_SIZE'
            ? 'Ukuran file melebihi batas maksimal 45 MB.'
            : `Gagal mengunggah file: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Terjadi kesalahan internal pada server API.';
      res.status(400).json({ error: message });
      return;
    }
    next(err);
  });

  // Never expose chat/development attachments over public HTTP
  app.use('/assets/aistudio', (_req, res) => {
    res.status(404).end();
  });

  const isProd =
    process.env.NODE_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
  if (!isProd) {
    let viteMiddlewares: express.RequestHandler | null = null;
    const viteReady = import('vite')
      .then(({ createServer: createViteServer }) =>
        createViteServer({
          server: { middlewareMode: true },
          appType: 'spa',
        })
      )
      .then((vite) => {
        viteMiddlewares = vite.middlewares;
      });

    app.use(async (req, res, next) => {
      try {
        if (!viteMiddlewares) {
          await viteReady;
        }
        viteMiddlewares!(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`SOP Brain server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
