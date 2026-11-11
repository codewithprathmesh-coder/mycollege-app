 import { createAuthenticatedSupabaseClient, createSupabaseAdminClient, supabaseAuth } from './supabaseAuthClient';
 import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
 import nodemailer from 'nodemailer';
 import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import {
  buildApprovedDataset,
  normalizeEmail,
  isValidEmailFormat,
  DIVISIONS,
  DIVISION_IDS,
  INSTITUTION_ID,
  DEPARTMENT_IDS,
  type ApprovedStudent,
  type Division,
} from './src/server/approvedStudentsData.ts';
import { FACULTY_DETAILS } from './src/server/facultyData.ts';
import {
  deleteSessionRecord,
  loadSessionRecord,
  saveSessionRecord,
  type SessionRecord,
} from './src/server/sessionStore.ts';
import {
  checkUserPassword,
  hasUserPassword,
  saveUserPassword,
  verifyPassword,
} from './src/server/passwordStore.ts';
import type {
  Announcement,
  AnnouncementCategory,
  AnnouncementStatus,
  AnnouncementAttachment,
  AppNotification,
  AuditLog,
  ChatChannel,
  ChatMessage,
  ChatPoll,
  CircleAnnouncement,
  Department,
  EventRegistration,
  Institution,
  PlatformStats,
  PriorityLevel,
  User,
  UserRole,
  UserNotificationPreferences,
} from './src/types/index.ts';

dotenv.config();

const supabaseAdmin = createSupabaseAdminClient();
const smtpHost = process.env.SMTP_HOST?.trim();
const smtpUser = process.env.SMTP_USER?.trim();
const smtpPass = process.env.SMTP_PASS?.trim();
const smtpFromEmail = process.env.SMTP_FROM_EMAIL?.trim() ||
  (smtpUser?.includes('@') ? smtpUser : null);
const smtpPort = Number(process.env.SMTP_PORT) || 587;
const smtpTransporter = smtpHost && smtpUser && smtpPass
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
  : null;
const smtpConfigured = Boolean(smtpTransporter && smtpFromEmail);
if (smtpConfigured && !supabaseAdmin) {
  console.warn('[AUTH] Custom OTP delivery requires SUPABASE_SERVICE_ROLE_KEY; using Supabase Auth email delivery instead.');
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('OPERATION_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ── Server readiness flag ───────────────────────────────────────────────────
// Set to true once startServer() completes; used to return 503 during cold start.
let serverReady = false;

// Universal CORS & Preflight handling
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-session-token, x-user-id');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initial Gemini AI client setup
let aiClient: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  } catch (err) {
    console.warn('Gemini client initialization notice:', err);
  }
}

function broadcastToInstitutionUsers(institutionId: string, payload: Record<string, unknown>) {
  const message = JSON.stringify(payload);
  for (const [socket, token] of clientSockets) {
    const session = activeSessions.get(token);
    const user = session && Date.now() < session.expiresAt
      ? users.find((candidate) => candidate.id === session.userId)
      : undefined;

    if (!user || user.institutionId !== institutionId) {
      clientSockets.delete(socket);
      socket.close(1008, 'Session expired');
      continue;
    }

    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

function broadcastToUser(userId: string, institutionId: string, payload: Record<string, unknown>) {
  const message = JSON.stringify(payload);
  for (const [socket, token] of clientSockets) {
    const session = activeSessions.get(token);
    const user = session && Date.now() < session.expiresAt
      ? users.find((candidate) => candidate.id === session.userId)
      : undefined;

    if (user?.id === userId && user.institutionId === institutionId && socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  }
}

// ----------------------------------------------------
// SECURE APPROVED STUDENT DATA & AUTHENTICATION STATE
// ----------------------------------------------------
const { report: initialApprovedDatasetReport } = buildApprovedDataset();
const facultyDetailsByEmail = new Map(
  FACULTY_DETAILS.map((faculty) => [normalizeEmail(faculty.email), faculty])
);

console.log('----------------------------------------------------');
console.log('🎓 College Communication App — SY AI-DS 2026–27');
console.log(`📊 Division A: ${initialApprovedDatasetReport.totalSuppliedDivisionA} entries`);
console.log(`📊 Division B: ${initialApprovedDatasetReport.totalSuppliedDivisionB} entries`);
console.log(`📊 Shared between divisions: ${initialApprovedDatasetReport.sharedAddressesCount} addresses`);
console.log(`📊 Unique authorized students: ${initialApprovedDatasetReport.uniqueAddressesOverall}`);
console.log('----------------------------------------------------');

interface OtpRequestLimit {
  lastRequestedAt: number;
  requestCountInWindow: number;
  windowStart: number;
}

const otpRequestLimits = new Map<string, OtpRequestLimit>();
const otpVerificationTypes = new Map<string, 'email' | 'magiclink'>();

const activeSessions = new Map<string, SessionRecord>();

// ----------------------------------------------------
// MULTI-TENANT IN-MEMORY / PERSISTED STATE
// ----------------------------------------------------

const institutions: Institution[] = [
  {
    id: INSTITUTION_ID,
    name: 'K. J. Somaiya institute of Engineering & Information Technology (KJSIEIT)',
    shortName: 'KJSIEIT',
    domain: 'somaiya.edu',
    allowedDomains: ['somaiya.edu', 'kjsieit.edu.in'],
    requireApproval: true,
    city: 'Sion, Mumbai, Maharashtra',
    established: '2003',
  },
  
  
];

const departments: Department[] = [
  {
    id: DEPARTMENT_IDS.computer,
    institutionId: INSTITUTION_ID,
    name: 'Computer Engineering',
    code: 'COMP',
    courses: ['B.Tech Computer Science', 'M.Tech AI & Data Science'],
  },
  {
    id: DEPARTMENT_IDS.informationTechnology,
    institutionId: INSTITUTION_ID,
    name: 'Information Technology',
    code: 'IT',
    courses: ['B.Tech Information Technology', 'M.Tech Cyber Security'],
  },
  {
    id: DEPARTMENT_IDS.electronics,
    institutionId: INSTITUTION_ID,
    name: 'Electronics & Telecommunication',
    code: 'EXTC',
    courses: ['B.Tech Electronics & Telecom'],
  },
  {
    id: DEPARTMENT_IDS.mechanical,
    institutionId: INSTITUTION_ID,
    name: 'Mechanical Engineering',
    code: 'MECH',
    courses: ['B.Tech Mechanical Engineering', 'M.Tech Robotics'],
  },
  {
    id: DEPARTMENT_IDS.artificialIntelligence,
    institutionId: INSTITUTION_ID,
    name: 'Artificial Intelligence & Data Science',
    code: 'AIDS',
    courses: ['B.Tech Artificial Intelligence & Data Science'],
  },
];

const users: User[] = [
  {
    id: 'user-student-1',
    institutionId: INSTITUTION_ID,
    name: 'Prathmesh Dhore',
    email: 'prathmesh.dhore@somaiya.edu',
    username: 'prathmesh_dhore',
    phone: '+91 98201 44512',
    rollNo: 'AIDS-25-01',
    role: 'student',
    departmentId: DEPARTMENT_IDS.artificialIntelligence,
    departmentName: 'Artificial Intelligence & Data Science',
    course: 'B.Tech Artificial Intelligence & Data Science',
    year: 'Second Year',
    division: 'SY-A-DIVISION AI-DS 2026–27',
    divisionIds: [DIVISION_IDS.a],
    divisionNames: ['SY-A-DIVISION AI-DS 2026–27'],
    interests: ['Artificial Intelligence', 'Sports', 'Technical Events'],
    orderedPreferences: ['Technical Events', 'Sports', 'Academics'],
    notificationPreferences: {
      academic: true,
      events: true,
      deadlines: true,
      clubs: true,
    },
    isVerified: true,
    isProfileCompleted: true,
  },
  ...FACULTY_DETAILS.map((faculty, index): User => ({
    id: `user-faculty-${index + 1}`,
    institutionId: INSTITUTION_ID,
    name: faculty.name,
    email: normalizeEmail(faculty.email),
    username: `faculty_${index + 1}`,
    role: 'faculty',
    departmentId: DEPARTMENT_IDS.artificialIntelligence,
    departmentName: 'Artificial Intelligence & Data Science',
    designation: faculty.designation,
    divisionIds: [],
    divisionNames: [],
    interests: ['Academics'],
    notificationPreferences: {
      academic: true,
      events: true,
      deadlines: true,
      clubs: true,
    },
    isVerified: true,
    isProfileCompleted: true,
  })),
  {
    id: 'user-coord-1',
    institutionId: INSTITUTION_ID,
    name: 'Priya Nair',
    email: 'priya.nair@somaiya.edu',
    username: 'priya_nair',
    phone: '+91 98210 55621',
    rollNo: 'IT-24-018',
    role: 'coordinator',
    departmentId: DEPARTMENT_IDS.informationTechnology,
    departmentName: 'Information Technology',
    course: 'B.Tech Information Technology',
    year: '3rd Year',
    division: 'Div A',
    divisionIds: [DIVISION_IDS.a, DIVISION_IDS.b],
    divisionNames: ['SY-A-DIVISION AI-DS 2026–27', 'SY-B-DIVISION AI-DS 2026–27'],
    assignedEntities: ['Coding Guild', 'Cultural Council', 'Hackathon Cell'],
    interests: ['Hackathons', 'Fests', 'Clubs'],
    notificationPreferences: {
      academic: false,
      events: true,
      deadlines: true,
      clubs: true,
    },
    isVerified: true,
    isProfileCompleted: true,
  },
  {
    id: 'user-admin-1',
    institutionId: INSTITUTION_ID,
    name: 'Dean S. K. Kulkarni',
    email: 'dean.academic@somaiya.edu',
    username: 'dean_kulkarni',
    phone: '+91 98200 12345',
    rollNo: 'ADMIN-01',
    role: 'admin',
    departmentId: DEPARTMENT_IDS.computer,
    departmentName: 'Dean of Academic Affairs',
    divisionIds: [DIVISION_IDS.a, DIVISION_IDS.b],
    divisionNames: ['SY-A-DIVISION AI-DS 2026–27', 'SY-B-DIVISION AI-DS 2026–27'],
    interests: ['Governance', 'Examinations', 'Academics'],
    notificationPreferences: {
      academic: true,
      events: true,
      deadlines: true,
      clubs: true,
    },
    isVerified: true,
    isProfileCompleted: true,
  },
  {
    id: 'user-admin-harshwardhan',
    institutionId: INSTITUTION_ID,
    name: 'Harshwardhan Patil',
    email: 'harshwardhanpatil241@gmail.com',
    username: 'harshwardhan_patil',
    phone: '+91 98200 11001',
    rollNo: 'ADMIN-02',
    role: 'admin',
    designation: 'trials',
    departmentId: DEPARTMENT_IDS.artificialIntelligence,
    departmentName: 'Artificial Intelligence & Data Science',
    divisionIds: [DIVISION_IDS.a, DIVISION_IDS.b],
    divisionNames: ['SY-A-DIVISION AI-DS 2026–27', 'SY-B-DIVISION AI-DS 2026–27'],
    interests: ['Administration', 'Academics'],
    notificationPreferences: {
      academic: true,
      events: true,
      deadlines: true,
      clubs: true,
    },
    isVerified: true,
    isProfileCompleted: true,
  },
  {
    id: 'user-student-jayshree',
    institutionId: INSTITUTION_ID,
    name: 'Jayshree Patil',
    email: 'pjayshree062@gmail.com',
    username: 'jayshree_patil',
    phone: '+91 98200 11002',
    rollNo: 'AIDS-25-T02',
    role: 'student',
    designation: 'trials',
    departmentId: DEPARTMENT_IDS.artificialIntelligence,
    departmentName: 'Artificial Intelligence & Data Science',
    course: 'B.Tech AI & Data Science',
    year: 'Second Year',
    division: 'SY-A-DIVISION AI-DS 2026–27',
    divisionIds: [DIVISION_IDS.a],
    divisionNames: ['SY-A-DIVISION AI-DS 2026–27'],
    interests: ['Artificial Intelligence', 'Academics'],
    notificationPreferences: {
      academic: true,
      events: true,
      deadlines: true,
      clubs: true,
    },
    isVerified: true,
    isProfileCompleted: true,
  },

  // Artificial Intelligence & Data Science (AIDS) - Division A Batch Directory (All 60 Students)
  ...(() => {
    const rawList = [
     
      { name: 'Zoheb Mansoori', roll: '060', phone: '98339 66145', interests: ['Transformers', 'Attention Models'] },
    ];

    return rawList.map((item, index): User => {
      const parts = item.name.toLowerCase().split(' ');
      const email = `${parts[0]}.${parts[1]}@somaiya.edu`;
      return {
        id: `user-aids-${index + 1}`,
        institutionId: INSTITUTION_ID,
        name: item.name,
        email,
        phone: `+91 ${item.phone}`,
        rollNo: `AIDS-24-${item.roll}`,
        role: 'student',
        departmentId: DEPARTMENT_IDS.artificialIntelligence,
        departmentName: 'Artificial Intelligence & Data Science',
        course: 'B.Tech AI & Data Science',
        year: '3rd Year',
        division: 'Div A',
        interests: item.interests,
        notificationPreferences: { academic: true, events: true, deadlines: true, clubs: true },
        isVerified: true,
      };
    });
  })(),

  // Additional Computer Engineering Div A Classmates
 
];

let announcements: Announcement[] = [

  
];

let notifications: AppNotification[] = [
  
];

const savedAnnouncementsByUser: Record<string, string[]> = {
  'user-student-1': ['ann-1', 'ann-2', 'ann-4'],
};

let registrations: EventRegistration[] = [
  
];

let auditLogs: AuditLog[] = [
  
  
];

let chatChannels: ChatChannel[] = [
 
 
  
];

let circleAnnouncements: CircleAnnouncement[] = [
  
];

let chatMessages: ChatMessage[] = [
  
  
];

const sessionCookieName = 'mycollege_session';
const sessionMaxAgeSeconds = 400 * 24 * 60 * 60;
const sessionRenewalThresholdMs = 30 * 24 * 60 * 60 * 1000;

function getSessionTokenFromRequest(req: { headers: { cookie?: string; authorization?: string; 'x-session-token'?: string } }): string | null {
  // 1. Direct header: x-session-token (mobile-resilient)
  const directToken = req.headers['x-session-token'];
  if (typeof directToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(directToken.trim())) {
    return directToken.trim();
  }

  // 2. Authorization header: Bearer <token>
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (/^[A-Za-z0-9_-]{43}$/.test(bearer)) {
      return bearer;
    }
  }

  // 3. Cookie fallback
  const sessionCookie = req.headers.cookie
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${sessionCookieName}=`));

  return sessionCookie
    ? /^[A-Za-z0-9_-]{43}$/.test(sessionCookie.slice(sessionCookieName.length + 1))
      ? sessionCookie.slice(sessionCookieName.length + 1)
      : null
    : null;
}

function setSessionCookie(res: Response, token: string, maxAgeSeconds: number): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${sessionCookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`
  );
}

function isAllowedOrigin(req: { headers: { origin?: string; host?: string } }): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;

  // Requests from native mobile apps (Capacitor/Cordova) or non-browser agents
  // often have no Origin header or set Origin: null
  if (!origin || origin === 'null') {
    return true;
  }

  // Capacitor Android / iOS local origins
  if (
    origin.startsWith('capacitor://') ||
    origin.startsWith('ionic://') ||
    origin.startsWith('http://localhost') ||
    origin.startsWith('https://localhost') ||
    origin.startsWith('http://127.0.0.1') ||
    origin.startsWith('https://127.0.0.1')
  ) {
    return true;
  }

  try {
    const originUrl = new URL(origin);

    // Exact host match (same-origin web requests)
    if (host && originUrl.host === host) {
      return true;
    }

    // Official production domain on Render or local development
    if (
      originUrl.host === 'mycollege-app.onrender.com' ||
      originUrl.host.endsWith('.onrender.com') ||
      originUrl.hostname === 'localhost' ||
      originUrl.hostname === '127.0.0.1'
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

const hasSameOrigin = isAllowedOrigin;

// Strict session-based user lookup
function getStrictAuthenticatedUser(req: Request): User | null {
  const token = getSessionTokenFromRequest(req);
  if (token) {
    const session = activeSessions.get(token);
    if (session && Date.now() < session.expiresAt) {
      const user = users.find((u) => u.id === session.userId);
      if (user) return user;
    }
  }

  // Never trust a caller-supplied user ID as proof of identity.
  return null;
}

async function getSupabaseClientForRequest(req: Request) {
  const token = getSessionTokenFromRequest(req);
  const session = token ? activeSessions.get(token) : undefined;
  if (!session || Date.now() >= session.expiresAt) return null;

  const supabase = createAuthenticatedSupabaseClient(session.supabaseAccessToken);
  const { data, error } = await supabase.auth.setSession({
    access_token: session.supabaseAccessToken,
    refresh_token: session.supabaseRefreshToken,
  });
  if (error || !data.session) {
    console.warn('Could not refresh the authenticated Supabase session:', error?.code);
    return null;
  }

  session.supabaseAccessToken = data.session.access_token;
  session.supabaseRefreshToken = data.session.refresh_token;
  const user = users.find((candidate) => candidate.id === session.userId);
  if (user) session.userSnapshot = user;
  try {
    await saveSessionRecord(session);
  } catch (saveError) {
    console.warn('Could not persist the refreshed session:', saveError);
  }
  return createAuthenticatedSupabaseClient(data.session.access_token);
}

interface ChannelDbRow {
  id: string;
  institution_id: string;
  department_id: string | null;
  division_id: string | null;
  creator_id: string | null;
  name: string;
  title: string;
  description: string;
  type: ChatChannel['type'];
  is_official: boolean;
  group_icon: string | null;
  only_admins_can_message: boolean;
  only_admins_can_edit_info: boolean;
  invite_code: string | null;
  pinned_announcement_id: string | null;
  pinned_message_id: string | null;
}

interface ChannelMemberDbRow {
  channel_id: string;
  profile_id: string;
  role: string;
  status: string;
}

interface ChannelMessageDbRow {
  id: string;
  channel_id: string;
  sender_id: string | null;
  content: string;
  attachment: ChatMessage['attachment'] | null;
  reply_to_id: string | null;
  reply_metadata: ChatMessage['replyTo'] | null;
  poll_data: ChatPoll | null;
  sender_name: string | null;
  sender_role: UserRole | null;
  sender_department: string | null;
  is_pinned: boolean;
  is_starred: boolean;
  status: ChatMessage['status'] | null;
  is_deleted: boolean;
  created_at: string;
}

function mapChannelRow(row: ChannelDbRow, memberships: ChannelMemberDbRow[] = []): ChatChannel {
  const activeMembers = memberships.filter((member) => member.status === 'active');
  const memberIds = activeMembers.map((member) => member.profile_id);
  const adminIds = activeMembers
    .filter((member) => member.role === 'admin' || member.role === 'owner')
    .map((member) => member.profile_id);

  // Automatically guarantee creator is recognized in memberIds & adminIds
  if (row.creator_id) {
    if (!memberIds.includes(row.creator_id)) memberIds.push(row.creator_id);
    if (!adminIds.includes(row.creator_id)) adminIds.push(row.creator_id);
  }

  return {
    id: row.id,
    institutionId: row.institution_id,
    departmentId: row.department_id || undefined,
    divisionId: row.division_id || undefined,
    name: row.name,
    title: row.title,
    description: row.description,
    type: row.type,
    isOfficial: row.is_official,
    memberCount: Math.max(activeMembers.length, memberIds.length),
    creatorId: row.creator_id || undefined,
    adminIds,
    memberIds,
    inviteCode: row.invite_code || undefined,
    pinnedAnnouncementId: row.pinned_announcement_id || undefined,
    pinnedMessageId: row.pinned_message_id || undefined,
    groupIcon: row.group_icon || undefined,
    onlyAdminsCanMessage: row.only_admins_can_message,
    onlyAdminsCanEditInfo: row.only_admins_can_edit_info,
  };
}

function userCanAccessChannel(user: User, channel: ChatChannel): boolean {
  if (!user || !channel) return false;

  // 1. System administrators have oversight across the institution
  if (user.role === 'admin') return true;

  // 2. Creator and appointed admins always have access
  if (channel.creatorId && channel.creatorId === user.id) return true;
  if (channel.adminIds && channel.adminIds.includes(user.id)) return true;

  // 3. Explicit active group members always have access
  if (channel.memberIds && channel.memberIds.includes(user.id)) return true;

  // 4. Official Class / Division Channels:
  // Class channels are bound to specific academic divisions
  if (channel.type === 'class') {
    // If bound to a specific division, only students enrolled in that division can access
    if (channel.divisionId) {
      if (user.divisionIds && user.divisionIds.includes(channel.divisionId)) return true;
      // Faculty teaching this department/division have access
      if (user.role === 'faculty' && (!channel.departmentId || user.departmentId === channel.departmentId)) {
        return true;
      }
      return false;
    }
    // General class channel without division
    if (!channel.departmentId || user.departmentId === channel.departmentId) {
      return true;
    }
  }

  // 5. All other custom groups (project, club, general, direct):
  // Non-members (students OR faculty) DO NOT HAVE ACCESS!
  return false;
}

function userCanManageChannel(user: User, channel: ChatChannel): boolean {
  if (!user || !channel) return false;
  return Boolean(
    user.role === 'admin' ||
    (channel.creatorId && channel.creatorId === user.id) ||
    (channel.adminIds && channel.adminIds.includes(user.id))
  );
}

function userCanAddChannelMembers(user: User, channel: ChatChannel): boolean {
  if (!user || !channel) return false;
  if (user.role === 'admin') return true;
  // Faculty can manage class channels for their department
  if (user.role === 'faculty' && channel.type === 'class') {
    return !channel.departmentId || user.departmentId === channel.departmentId;
  }
  // For all other groups, only circle creator / appointed admins can add members
  return userCanManageChannel(user, channel);
}

function mapChannelMessageRow(
  row: ChannelMessageDbRow,
  reactions: Record<string, string[]> = {}
): ChatMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    institutionId: '',
    senderId: row.sender_id || 'system',
    senderName: row.sender_name || 'Campus Bot',
    senderRole: row.sender_role || 'admin',
    senderDepartment: row.sender_department || undefined,
    content: row.is_deleted ? '🚫 This message was deleted' : row.content,
    timestamp: row.created_at,
    attachment: row.is_deleted ? undefined : row.attachment || undefined,
    replyTo: row.reply_metadata || undefined,
    poll: row.is_deleted ? undefined : row.poll_data || undefined,
    reactions,
    isPinned: row.is_pinned,
    isStarred: row.is_starred,
    status: row.status || 'sent',
    deleted: row.is_deleted,
  };
}

async function loadChannelForRequest(
  req: Request,
  res: Response,
  channelId: string
): Promise<ChatChannel | null> {
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
    return null;
  }
  const db = createSupabaseAdminClient() || supabase;
  const { data: row, error } = await db
    .from('channels')
    .select('*')
    .eq('id', channelId)
    .maybeSingle();
  if (error) {
    console.error('Could not load channel from Supabase:', error.code);
    res.status(503).json({ error: 'Could not load this group. Please try again later.' });
    return null;
  }
  if (!row) {
    res.status(404).json({ error: 'Channel not found.' });
    return null;
  }
  const { data: memberships, error: membersError } = await db
    .from('channel_members')
    .select('profile_id, role, status')
    .eq('channel_id', channelId);
  if (membersError) {
    console.error('Could not load channel memberships from Supabase:', membersError.code);
    res.status(503).json({ error: 'Could not load group membership. Please try again later.' });
    return null;
  }
  const channel = mapChannelRow(row as ChannelDbRow, (memberships || []) as ChannelMemberDbRow[]);
  const currentUser = getCurrentUser(req);
  if (channel.institutionId !== currentUser.institutionId || !userCanAccessChannel(currentUser, channel)) {
    res.status(403).json({ error: 'You must be an active group member to access this circle.' });
    return null;
  }
  const cacheIndex = chatChannels.findIndex((candidate) => candidate.id === channel.id);
  if (cacheIndex >= 0) chatChannels[cacheIndex] = channel;
  else chatChannels.push(channel);
  return channel;
}

async function persistAuditLog(req: Request, log: AuditLog): Promise<boolean> {
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    console.error('Could not persist audit log: authenticated Supabase session is unavailable.');
    return false;
  }
  const { error } = await supabase.from('audit_logs').insert({
    institution_id: log.institutionId,
    profile_id: log.userId,
    user_name: log.userName,
    user_role: log.userRole,
    action: log.action,
    details: log.details,
    created_at: log.timestamp,
  });
  if (error) {
    console.error('Could not persist audit log in Supabase:', error.code);
    return false;
  }
  return true;
}

type AuthenticatedSupabaseClient = ReturnType<typeof createAuthenticatedSupabaseClient>;

async function persistChannelSystemMessage(
  supabase: any,
  channel: ChatChannel,
  actor: User,
  senderName: string,
  content: string
): Promise<ChatMessage | null> {
  const adminDb = createSupabaseAdminClient() || supabase;
  const { data, error } = await adminDb
    .from('channel_messages')
    .insert({
      id: crypto.randomUUID(),
      channel_id: channel.id,
      sender_id: actor.id,
      sender_name: senderName,
      sender_role: actor.role,
      sender_department: actor.departmentName || null,
      content,
      status: 'sent',
    })
    .select('*')
    .single();
  if (error || !data) {
    console.error('Could not persist channel system message in Supabase:', error?.code);
    return null;
  }
  const message = mapChannelMessageRow(data as ChannelMessageDbRow);
  message.institutionId = channel.institutionId;
  chatMessages.push(message);
  return message;
}

// Standard helper with safe fallback for existing endpoints
function getCurrentUser(req: Request): User {
  const authed = getStrictAuthenticatedUser(req);
  if (authed) return authed;
  throw new Error('Authenticated API route was accessed without a valid session.');
}

// Require authenticated user helper
function requireAuth(req: Request, res: Response): User | null {
  const user = getStrictAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please sign in with your authorized student email.' });
    return null;
  }
  return user;
}

// Protect API routes by default. Only OTP/session bootstrap and public division metadata
// are accessible without an authenticated session. A caller-supplied x-user-id is never identity proof.
app.use('/api', async (req: Request, res: Response, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isAllowedOrigin(req)) {
    return res.status(403).json({ error: 'Request origin is not allowed.' });
  }

  // Exempt attachment view and download endpoints so Google Docs Viewer and mobile downloaders can stream files
  if (req.method === 'GET' && req.path.includes('/attachments/') && (req.path.endsWith('/view') || req.path.endsWith('/download'))) {
    return next();
  }

  const publicPaths = new Set([
    '/auth/request-otp',
    '/auth/verify-otp',
    '/auth/check-auth-method',
    '/auth/login-password',
    '/auth/set-password',
    '/auth/session',
    '/divisions',
    '/health',
    '/supabase-health',
    '/supabase-auth-health',
    '/download/apk',
    '/download/app',
    '/api/download/apk',
  ]);
  const pathsWithoutSessionRestore = new Set([
    '/auth/request-otp',
    '/auth/verify-otp',
    '/auth/check-auth-method',
    '/auth/login-password',
    '/auth/set-password',
    '/divisions',
    '/health',
    '/supabase-health',
    '/supabase-auth-health',
    '/download/apk',
    '/download/app',
    '/api/download/apk',
  ]);
  const token = getSessionTokenFromRequest(req);
  if (token && !pathsWithoutSessionRestore.has(req.path)) {
    let session = activeSessions.get(token);
    try {
      if (!session) {
        const storedSession = await loadSessionRecord(token);
        if (storedSession) {
          session = storedSession;
          activeSessions.set(token, session);
        }
      }
    } catch (restoreError) {
      console.warn('Could not restore persistent session from DB:', restoreError);
    }

    if (session && Date.now() >= session.expiresAt) {
      activeSessions.delete(token);
      session = undefined;
    }

    if (session) {
      if (session.expiresAt - Date.now() <= sessionRenewalThresholdMs) {
        session.expiresAt = Date.now() + sessionMaxAgeSeconds * 1000;
        setSessionCookie(res, token, sessionMaxAgeSeconds);
        void saveSessionRecord(session).catch((saveError: unknown) => {
          console.error('Could not renew the persistent sign-in session:', saveError);
        });
      }
      const previousSnapshot = JSON.stringify(session.userSnapshot);
      const user = users.find((candidate) => candidate.id === session.userId);
      if (user) {
        session.userSnapshot = user;
      } else {
        users.push(session.userSnapshot);
      }
      res.once('finish', () => {
        const currentUser = users.find((candidate) => candidate.id === session?.userId);
        if (currentUser && JSON.stringify(currentUser) !== previousSnapshot) {
          session!.userSnapshot = currentUser;
          void saveSessionRecord(session!).catch((saveError: unknown) => {
            console.error('Could not persist the updated session user snapshot:', saveError);
          });
        }
      });
    }
  }

  if (publicPaths.has(req.path)) return next();
  const authenticatedUser = getStrictAuthenticatedUser(req);
  if (!authenticatedUser) {
    return res.status(401).json({ error: 'Authentication required. Please sign in with your authorized college email.' });
  }
  if (
    !authenticatedUser.isProfileCompleted &&
    !authenticatedUser.termsAcceptedAt &&
    req.path !== '/auth/accept-terms' &&
    req.path !== '/auth/logout'
  ) {
    return res.status(403).json({ error: 'Please accept the MyCollege terms and conditions before continuing.' });
  }
  next();
});


// Direct APK Download Portal & Redirect
app.get(['/download/apk', '/download/app', '/api/download/apk'], (req: Request, res: Response) => {
  const directUrl = 'https://github.com/codewithprathmesh-coder/mycollege-app/releases/download/v1.0.0/MyCollege.apk';
  if (req.query.direct === '1') {
    return res.redirect(directUrl);
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Download MyCollege App</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      margin: 0; padding: 0;
      background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%);
      color: #0f172a;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
      box-sizing: border-box;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 1.5rem;
      padding: 2rem;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.05);
      text-align: center;
      box-sizing: border-box;
    }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #1d4ed8;
      background: #dbeafe;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      margin-bottom: 1rem;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 0.875rem 1.25rem;
      background: linear-gradient(135deg, #2563eb, #4f46e5);
      color: #ffffff;
      font-weight: 700;
      font-size: 0.95rem;
      text-decoration: none;
      border-radius: 0.75rem;
      margin: 1.25rem 0 0.75rem 0;
      box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);
      box-sizing: border-box;
    }
    .step {
      text-align: left;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 0.75rem;
      padding: 0.75rem 1rem;
      margin-top: 0.75rem;
      font-size: 0.85rem;
    }
    .step-num {
      display: inline-block;
      width: 20px;
      height: 20px;
      line-height: 20px;
      border-radius: 50%;
      background: #2563eb;
      color: #fff;
      text-align: center;
      font-size: 0.75rem;
      font-weight: 700;
      margin-right: 0.5rem;
    }
    .alert {
      background: #fffbeb;
      border: 1px solid #fef3c7;
      color: #92400e;
      padding: 0.75rem;
      border-radius: 0.75rem;
      font-size: 0.8rem;
      margin-top: 1rem;
      text-align: left;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Official Mobile App</div>
    <h1 style="font-size: 1.5rem; font-weight: 800; margin: 0 0 0.5rem 0;">MyCollege Android App</h1>
    <p style="font-size: 0.875rem; color: #64748b; margin: 0 0 1rem 0;">Direct APK installer for K. J. Somaiya faculty, staff, and students.</p>
    
    <a href="${directUrl}" class="btn" id="dlBtn">
      ⬇️ Download MyCollege.apk (Direct)
    </a>

    <div style="font-size: 0.8rem; color: #64748b; margin-top: 0.5rem;">
      Compatible with all Android devices (Android 7.0 to 15+)
    </div>

    <div style="margin-top: 1.25rem;">
      <div class="step"><span class="step-num">1</span> Tap <b>Download MyCollege.apk</b> above.</div>
      <div class="step"><span class="step-num">2</span> Open your phone's <b>Downloads / Files</b> app and tap <b>MyCollege.apk</b>.</div>
      <div class="step"><span class="step-num">3</span> Tap <b>Install</b> <i>(If asked, toggle "Allow from this source" to ON)</i>.</div>
    </div>

    <div class="alert">
      💡 <b>Troubleshooting:</b> If your phone says <i>"You don't have proper application to install this application"</i>, it means a <code>.zip</code> file was clicked instead of the <code>.apk</code>. Tap the blue button above to get the direct <code>.apk</code> file.
    </div>
  </div>
</body>
</html>`);
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: serverReady ? 'ok' : 'starting',
    ready: serverReady,
    authProvider: 'supabase',
    deployment: process.env.RENDER_GIT_COMMIT?.slice(0, 7) || 'unknown',
    otpDelivery: supabaseAdmin && smtpConfigured
      ? 'smtp'
      : 'supabase-auth',
    smtpConfigured,
    supabaseAdminConfigured: Boolean(supabaseAdmin),
  });
});

app.get('/api/supabase-health', async (_req, res) => {
  const { data, error } = await supabaseAuth.rpc('mycollege_health_check');

  if (error || data !== true) {
    console.error('Supabase health check failed:', error);

    return res.status(500).json({
      connected: false,
      code: error?.code ?? 'HEALTH_CHECK_FAILED',
      message: 'Supabase database health check failed.',
    });
  }

  return res.json({
    connected: true,
    message: 'Supabase database health check succeeded.',
  });
});


app.get('/api/supabase-auth-health', async (_req, res) => {
  const { data, error } = await supabaseAuth.auth.getSession();

  if (error) {
    console.error('Supabase Auth check failed:', error);

    return res.status(500).json({
      connected: false,
      message: 'Supabase Auth check failed',
    });
  }

  return res.json({
    connected: true,
    hasSession: Boolean(data.session),
    message: 'Supabase Auth client initialized',
  });
});


// ----------------------------------------------------
// REST API ENDPOINTS
// ----------------------------------------------------

// ----------------------------------------------------
// AUTHENTICATION & STUDENT ACCESS CONTROL
// ----------------------------------------------------

// 1. Request One-Time Verification Code (OTP)
app.post('/api/auth/request-otp', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email address is required.' });
  }

  const norm = normalizeEmail(email);
  if (!isValidEmailFormat(norm)) {
    return res.status(400).json({ error: 'Please enter a valid college email address format.' });
  }

  // 2. Strict Rate Limiting (Abuse prevention)
  const now = Date.now();
  let existing = otpRequestLimits.get(norm);

  if (existing) {
    // 15-minute window check
    if (now - existing.windowStart > 15 * 60 * 1000) {
      existing.windowStart = now;
      existing.requestCountInWindow = 0;
    }

    if (existing.requestCountInWindow >= 4) {
      const waitMinutes = Math.ceil((15 * 60 * 1000 - (now - existing.windowStart)) / 60000);
      return res.status(429).json({
        error: `Too many verification requests. Please wait ${waitMinutes} minute(s) before requesting another code.`,
      });
    }

    // 45-second cooldown between successive requests
    if (now - existing.lastRequestedAt < 45 * 1000) {
      const waitSeconds = Math.ceil((45 * 1000 - (now - existing.lastRequestedAt)) / 1000);
      return res.status(429).json({
        error: `Please wait ${waitSeconds} seconds before requesting a new code.`,
      });
    }
  }

  let verificationType: 'email' | 'magiclink' = 'email';
  let otpDelivered = false;

  // 1. Primary: Deliver via Supabase Auth (which routes through Brevo custom SMTP)
  const { error: otpError } = await supabaseAuth.auth.signInWithOtp({
    email: norm,
    options: { shouldCreateUser: true },
  });

  if (!otpError) {
    otpDelivered = true;
    verificationType = 'email';
  } else {
    console.warn('[AUTH] Supabase Auth signInWithOtp failed, trying direct SMTP fallback:', otpError.message || otpError.code);

    // 2. Fallback: Direct server SMTP if configured
    if (smtpConfigured && supabaseAdmin && smtpFromEmail) {
      try {
        let linkResult = await withTimeout(supabaseAdmin.auth.admin.generateLink({
          type: 'signup',
          email: norm,
          password: crypto.randomBytes(32).toString('hex'),
        }), 12_000);

        const alreadyRegistered = linkResult.error && (
          ['user_already_exists', 'email_exists'].includes(linkResult.error.code || '') ||
          linkResult.error.message.toLowerCase().includes('already registered')
        );

        if (alreadyRegistered) {
          linkResult = await withTimeout(supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: norm,
          }), 12_000);
          verificationType = 'magiclink';
        }

        if (linkResult.data?.properties?.email_otp && smtpTransporter) {
          const code = linkResult.data.properties.email_otp;
          const message = {
            from: `"MyCollege Security" <${smtpFromEmail}>`,
            to: norm,
            subject: 'Your MyCollege verification code',
            text: `Your MyCollege verification code is ${code}. It expires in 5 minutes. Do not share this code with anyone.`,
            html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#0f172a"><h2>MyCollege verification</h2><p>Your single-use verification code is:</p><p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#2563eb">${code}</p><p>This code expires in 5 minutes. If you did not request it, you can ignore this email.</p></div>`,
          };
          await smtpTransporter.sendMail(message);
          otpDelivered = true;
        }
      } catch (fallbackError) {
        console.warn('[AUTH] Direct SMTP fallback also failed:', fallbackError);
      }
    }
  }

  if (!otpDelivered) {
    return res.status(503).json({
      error: 'We could not deliver the verification email. Please try again later.',
    });
  }

  otpVerificationTypes.set(norm, verificationType);
  otpRequestLimits.set(norm, {
    lastRequestedAt: now,
    requestCountInWindow: (existing?.requestCountInWindow || 0) + 1,
    windowStart: existing?.windowStart || now,
  });

  res.json({
    success: true,
    email: norm,
    expiresInSeconds: 300,
    deliveryNote: `If ${norm} is authorized, a verification code will arrive in the college inbox.`,
  });
});

// 2. Verify One-Time Code & Authenticate Session
app.post('/api/auth/verify-otp', async (req: Request, res: Response) => {
  const { email, code } = req.body;
  if (typeof email !== 'string' || typeof code !== 'string') {
    return res.status(400).json({ error: 'Email and verification code are required.' });
  }

  const norm = normalizeEmail(email);
  const cleanCode = String(code).trim();
  if (!/^\d{6}$/.test(cleanCode)) {
    return res.status(400).json({ error: 'Verification code must be exactly 6 numeric digits.' });
  }

  const facultyDetails = facultyDetailsByEmail.get(norm);
  let authData: { user: any; session: any } | null = null;
  let authError: any = null;

  const typesToTry: ('email' | 'signup')[] = ['email', 'signup'];

  for (const t of typesToTry) {
    const attempt = await supabaseAuth.auth.verifyOtp({
      email: norm,
      token: cleanCode,
      type: t,
    });
    if (!attempt.error && attempt.data.user && attempt.data.session) {
      authData = attempt.data;
      authError = null;
      break;
    } else {
      authError = attempt.error;
    }
  }

  if (authError || !authData?.user || !authData?.session) {
    console.warn('[AUTH] Supabase OTP verification failed:', authError?.code || authError?.status);
    return res.status(400).json({ error: 'The verification code is invalid or expired. Request a new code and try again.' });
  }
  otpVerificationTypes.delete(norm);

  return await buildUserSessionAndRespond(authData, norm, req, res, 'otp');
});

/**
 * Reusable user session generator & responder
 * Ensures persistent 400-day cookies and identical profile hydration for both OTP and Password logins
 */
async function buildUserSessionAndRespond(
  authData: { user: any; session: any },
  norm: string,
  req: Request,
  res: Response,
  authMethod: 'otp' | 'password' = 'otp'
) {
  const facultyDetails = facultyDetailsByEmail.get(norm);
  const userSupabase = createAuthenticatedSupabaseClient(authData.session.access_token);
  const { data: isAuthorized, error: authorizationError } = await userSupabase
    .rpc('mycollege_is_authorized_email');
  if (authorizationError) {
    console.error('Could not verify the signed-in college account:', authorizationError.code);
    return res.status(503).json({ error: 'Account authorization is temporarily unavailable. Please try again later.' });
  }
  if (isAuthorized !== true) {
    return res.status(403).json({ error: 'This account is not authorized to access the college application.' });
  }

  const { data: profile, error: profileError } = await userSupabase
    .from('profiles')
    .select('id, email, full_name, role, institution_id, department_id, username, designation, course, year, roll_no, phone, avatar_url, is_verified, is_profile_completed, terms_accepted_at')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    console.error('Authenticated user has no provisioned MyCollege profile:', profileError?.code);
    return res.status(503).json({ error: 'Your college profile is not provisioned yet. Contact the administrator.' });
  }

  // Find or create the provisioned faculty account or an approved student account.
  let user = users.find((u) => normalizeEmail(u.email) === norm);
  let isFirstTime = false;

  const profileRole = profile.role === 'teacher' ? 'faculty' : profile.role;
  const isAllowedRole = ['student', 'faculty', 'coordinator', 'admin'].includes(profileRole);
  if (!isAllowedRole) {
    return res.status(403).json({ error: 'Your account has an unsupported application role.' });
  }
  const isFacultyLogin = profileRole === 'faculty';
  let divisionIds: string[] = [];
  if (!isFacultyLogin) {
    const { data: profileDivisions, error: divisionsError } = await userSupabase
      .from('profile_divisions')
      .select('division_id')
      .eq('profile_id', authData.user.id);
    if (divisionsError) {
      console.error('Could not load the signed-in user divisions:', divisionsError.code);
      return res.status(503).json({ error: 'Could not load your college divisions. Please try again later.' });
    }
    divisionIds = profileDivisions.map((row: { division_id: string }) => row.division_id);
  }
  const divisionLabels = divisionIds.map((dId) => {
    const d = DIVISIONS.find((div) => div.id === dId);
    return d ? d.name : dId;
  });
  const { data: batchDetails, error: batchDetailsError } = await userSupabase
    .from('mycollege_batch_directory')
    .select('full_name, roll_no, department_id, academic_year, division_id, phone')
    .eq('profile_id', authData.user.id)
    .maybeSingle();
  if (batchDetailsError) {
    console.error('Could not load persisted batch details:', batchDetailsError.code);
    return res.status(503).json({
      error: 'Could not load your saved batch details. Please try again later.',
    });
  }

  if (!user) {
    const namePart = norm.split('@')[0];
    const autoName = profile.full_name || facultyDetails?.name || namePart
      .split('.')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');

    user = {
      id: authData.user.id,
      institutionId: profile.institution_id,
      name: batchDetails?.full_name || autoName,
      email: norm,
      username: profile.username || '',
      role: profileRole as UserRole,
      departmentId:
        batchDetails?.department_id ||
        profile.department_id ||
        DEPARTMENT_IDS.artificialIntelligence,
      departmentName:
        departments.find(
          (department) =>
            department.id ===
            (batchDetails?.department_id || profile.department_id)
        )?.name ||
        'Artificial Intelligence & Data Science',
      ...(batchDetails?.phone || profile.phone
        ? { phone: batchDetails?.phone || profile.phone }
        : {}),
      ...(batchDetails?.roll_no || profile.roll_no
        ? { rollNo: batchDetails?.roll_no || profile.roll_no }
        : {}),
      ...(profile.designation || facultyDetails ? { designation: profile.designation || facultyDetails?.designation } : {}),
      ...(isFacultyLogin
        ? {}
        : {
            course:
              profile.course ||
              departments.find(
                (department) =>
                  department.id ===
                  (batchDetails?.department_id || profile.department_id)
              )?.courses[0] ||
              'B.Tech Artificial Intelligence & Data Science',
            year: batchDetails?.academic_year || profile.year || 'Second Year',
            division: divisionLabels.join(' & '),
          }),
      divisionIds: [...divisionIds],
      divisionNames: divisionLabels,
      interests: isFacultyLogin ? ['Academics'] : ['Artificial Intelligence', 'Academics'],
      orderedPreferences: ['Academics', 'Technical Events', 'Sports'],
      notificationPreferences: {
        academic: true,
        events: true,
        deadlines: true,
        clubs: true,
      },
      isVerified: profile.is_verified,
      isProfileCompleted: profile.is_profile_completed,
    };
    users.push(user);
  } else {
    user.id = authData.user.id;
    user.institutionId = profile.institution_id;
    const departmentId =
      batchDetails?.department_id || profile.department_id || user.departmentId;
    user.departmentId = departmentId;
    user.departmentName =
      departments.find((department) => department.id === departmentId)?.name ||
      user.departmentName;
    user.name = batchDetails?.full_name || profile.full_name || facultyDetails?.name || user.name;
    user.username = profile.username || user.username;
    user.phone = profile.phone || user.phone;
    if (batchDetails?.phone || profile.phone) user.phone = batchDetails?.phone || profile.phone;
    if (batchDetails?.roll_no || profile.roll_no) {
      user.rollNo = batchDetails?.roll_no || profile.roll_no;
    }
    if (!isFacultyLogin) {
      user.course =
        profile.course ||
        departments.find((department) => department.id === departmentId)?.courses[0] ||
        user.course;
      user.year = batchDetails?.academic_year || profile.year || user.year;
    }
    user.avatar = profile.avatar_url || user.avatar;
    user.designation = profile.designation || facultyDetails?.designation || user.designation;
    user.role = profileRole as UserRole;
    user.isVerified = profile.is_verified;
    user.isProfileCompleted = profile.is_profile_completed;
    user.termsAcceptedAt = profile.terms_accepted_at || undefined;
    user.divisionIds = [...divisionIds];
    user.divisionNames = divisionLabels;
    user.division = divisionLabels.join(' & ');
  }
  if (!user) {
    throw new Error('Could not construct the authenticated application user.');
  }
  const { data: savedSettings, error: settingsError } = await userSupabase
    .from('app_user_settings')
    .select('interests, ordered_preferences, notification_preferences')
    .eq('profile_id', authData.user.id)
    .maybeSingle();
  if (settingsError) {
    console.error('Could not load persisted user settings:', settingsError.code);
    return res.status(503).json({
      error: 'Could not load your saved preferences. Please check that the latest Supabase migration has been applied.',
    });
  }
  if (savedSettings) {
    user.interests = savedSettings.interests;
    if (savedSettings.ordered_preferences.length === 3) {
      user.orderedPreferences = savedSettings.ordered_preferences as [string, string, string];
    }
    user.notificationPreferences = savedSettings.notification_preferences as UserNotificationPreferences;
  }
  isFirstTime = !profile.is_profile_completed;

  // Auto-enroll student into their division channels
  for (const divId of divisionIds) {
    const ch = chatChannels.find((c) => c.divisionId === divId);
    if (ch) {
      if (!ch.memberIds) ch.memberIds = [];
      if (!ch.memberIds.includes(user.id)) {
        ch.memberIds.push(user.id);
        ch.memberCount = ch.memberIds.length;
      }
    }
  }

  // Generate genuine session token (400-day duration)
  const token = crypto.randomBytes(32).toString('base64url');
  const session: SessionRecord = {
    token,
    userId: user.id,
    authUserId: authData.user.id,
    email: user.email,
    supabaseAccessToken: authData.session.access_token,
    supabaseRefreshToken: authData.session.refresh_token,
    createdAt: Date.now(),
    expiresAt: Date.now() + sessionMaxAgeSeconds * 1000,
    userSnapshot: user,
  };
  try {
    await saveSessionRecord(session);
  } catch (saveError) {
    console.warn('Could not create a persistent database sign-in session, continuing with in-memory session:', saveError);
  }
  activeSessions.set(token, session);
  setSessionCookie(res, token, sessionMaxAgeSeconds);

  // Audit log
  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: INSTITUTION_ID,
    userId: user.id,
    userName: user.name,
    userRole: user.role,
    action: isFacultyLogin ? 'FACULTY_SIGNED_IN' : 'STUDENT_SIGNED_IN',
    details: `${user.role} ${user.email} authenticated via ${authMethod === 'password' ? 'account password' : 'single-use OTP'}.`,
    timestamp: new Date().toISOString(),
  });
  await persistAuditLog(req, auditLogs[0]);

  const matchingDivisions = DIVISIONS.filter((d) => divisionIds.includes(d.id));

  const hasPassword = await hasUserPassword(norm);

  return res.json({
    user,
    token,
    isFirstTime,
    divisions: matchingDivisions,
    requiresPasswordSetup: !hasPassword,
  });
}

// 2a. Check Auth Method (checks if email has password set)
app.post('/api/auth/check-auth-method', async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email address is required.' });
  }

  const norm = normalizeEmail(email);
  if (!isValidEmailFormat(norm)) {
    return res.status(400).json({ error: 'Please enter a valid college email address.' });
  }

  const isFaculty = facultyDetailsByEmail.has(norm);
  const isUser = users.some((u) => normalizeEmail(u.email) === norm);
  let isAuthorized = isFaculty || isUser;

  if (!isAuthorized) {
    const supabaseAdmin = createSupabaseAdminClient();
    if (supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', norm)
        .maybeSingle();
      if (data?.id) isAuthorized = true;
    }
  }

  const hasPassword = await hasUserPassword(norm);

  res.json({
    exists: isAuthorized,
    hasPassword,
  });
});

// 2b. Sign In directly with Email & Password
app.post('/api/auth/login-password', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const norm = normalizeEmail(email);
  const passwordCheck = await checkUserPassword(norm, password);
  if (!passwordCheck.valid) {
    return res.status(401).json({
      error: 'Invalid email or password. If you forgot your password, please sign in with OTP.',
    });
  }

  // Authenticate session with Supabase
  let authData: { user: any; session: any } | null = null;
  const supabaseAttempt = await supabaseAuth.auth.signInWithPassword({
    email: norm,
    password,
  });

  if (!supabaseAttempt.error && supabaseAttempt.data?.user && supabaseAttempt.data?.session) {
    authData = supabaseAttempt.data;
  } else {
    // If Supabase Auth password was not in sync, sync it now via admin client
    const supabaseAdmin = createSupabaseAdminClient();
    if (supabaseAdmin) {
      let targetUserId = passwordCheck.profileId;
      if (!targetUserId) {
        const { data: p } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('email', norm)
          .maybeSingle();
        targetUserId = p?.id;
      }

      if (targetUserId) {
        try {
          await supabaseAdmin.auth.admin.updateUserById(targetUserId, { password });
          const retry = await supabaseAuth.auth.signInWithPassword({ email: norm, password });
          if (!retry.error && retry.data?.user && retry.data?.session) {
            authData = retry.data;
          }
        } catch (syncErr) {
          console.warn('[AUTH] Could not resync password to Supabase Auth:', syncErr);
        }
      }

      if (!authData && targetUserId) {
        // Fallback: fetch user details and build valid tokens
        const { data: userData } = await supabaseAdmin.auth.admin.getUserById(targetUserId);
        if (userData?.user) {
          authData = {
            user: userData.user,
            session: {
              access_token: crypto.randomBytes(32).toString('hex'),
              refresh_token: crypto.randomBytes(32).toString('hex'),
            },
          };
        }
      }
    }
  }

  if (!authData?.user || !authData?.session) {
    return res.status(500).json({
      error: 'Could not initialize session. Please sign in with OTP or request a password reset.',
    });
  }

  return await buildUserSessionAndRespond(authData, norm, req, res, 'password');
});

// 2c. Set / Initialize Account Password after OTP verification
app.post('/api/auth/set-password', async (req: Request, res: Response) => {
  const { email, password, token } = req.body;
  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  const norm = normalizeEmail(email);
  const authUser = getCurrentUser(req);
  const reqToken = token || getSessionTokenFromRequest(req);
  const activeSession = reqToken ? activeSessions.get(reqToken) : undefined;

  if (!authUser && !activeSession) {
    return res.status(401).json({ error: 'Unauthorized. Please verify via OTP before setting a password.' });
  }

  const sessionEmail = activeSession
    ? normalizeEmail(activeSession.email)
    : authUser
      ? normalizeEmail(authUser.email)
      : '';

  if (sessionEmail && sessionEmail !== norm) {
    return res.status(403).json({ error: 'You can only set a password for your own authenticated account.' });
  }

  const profileId = activeSession?.authUserId || authUser?.id;
  await saveUserPassword(norm, password, profileId);

  res.json({ success: true, message: 'Password saved successfully.' });
});

// 2d. Change Password from Profile Menu (Authenticated)
app.post('/api/auth/change-password', async (req: Request, res: Response) => {
  const currentUser = getStrictAuthenticatedUser(req);
  if (!currentUser) {
    return res.status(401).json({ error: 'Please sign in to change your password.' });
  }

  const { currentPassword, newPassword } = req.body;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }

  if (newPassword === currentPassword) {
    return res.status(400).json({ error: 'New password must be different from current password.' });
  }

  const norm = normalizeEmail(currentUser.email);
  const hasExisting = await hasUserPassword(norm);

  if (hasExisting) {
    const isCurrentValid = await checkUserPassword(norm, currentPassword);
    if (!isCurrentValid.valid) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
  }

  await saveUserPassword(norm, newPassword, currentUser.id);

  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: INSTITUTION_ID,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'PASSWORD_UPDATED',
    details: `${currentUser.role} ${currentUser.email} updated account password.`,
    timestamp: new Date().toISOString(),
  });
  await persistAuditLog(req, auditLogs[0]);

  res.json({ success: true, message: 'Password updated successfully.' });
});

// 3. Live Username Availability Check
app.get('/api/auth/check-username', (req: Request, res: Response) => {
  const raw = (req.query.username as string) || '';
  const username = raw.trim().toLowerCase();

  if (!username) {
    return res.status(400).json({ available: false, message: 'Username is required.' });
  }

  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ available: false, message: 'Username must be between 3 and 20 characters.' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ available: false, message: 'Username can only contain letters, numbers, and underscores.' });
  }

  const currentUser = getStrictAuthenticatedUser(req);
  const exists = users.some(
    (u) => u.username && u.username.toLowerCase() === username && u.id !== currentUser?.id
  );

  if (exists) {
    return res.json({ available: false, message: 'This username is already taken. Please choose another.' });
  }

  res.json({ available: true, message: 'Username is available!' });
});

app.post('/api/auth/accept-terms', async (req: Request, res: Response) => {
  const currentUser = requireAuth(req, res);
  if (!currentUser) return;

  const termsAcceptedAt = new Date().toISOString();
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const sessionToken = getSessionTokenFromRequest(req);
  const authUserId = sessionToken ? activeSessions.get(sessionToken)?.authUserId : undefined;
  if (!authUserId) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { error } = await supabase
    .from('profiles')
    .update({ terms_accepted_at: termsAcceptedAt })
    .eq('id', authUserId);
  if (error) {
    console.error('Could not save terms acceptance:', error.code);
    return res.status(500).json({ error: 'Could not save your terms acceptance. Please try again.' });
  }
  currentUser.termsAcceptedAt = termsAcceptedAt;
  res.json({ user: currentUser, message: 'Terms and conditions accepted.' });
});

// 4. Complete First-Time Student Profile
app.post('/api/auth/complete-profile', async (req: Request, res: Response) => {
  const currentUser = requireAuth(req, res);
  if (!currentUser) return;

  const { name, username, interests, avatar } = req.body;
  const facultyDetails = facultyDetailsByEmail.get(normalizeEmail(currentUser.email));

  if (!facultyDetails && (!name || typeof name !== 'string' || name.trim().length < 2)) {
    return res.status(400).json({ error: 'Please enter your full legal name.' });
  }

  const cleanUsername = (username || '').trim().toLowerCase();
  if (!cleanUsername || cleanUsername.length < 3 || cleanUsername.length > 20) {
    return res.status(400).json({ error: 'Username must be 3-20 characters long.' });
  }

  if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores.' });
  }
  if (interests !== undefined && (!Array.isArray(interests) || !interests.every((value) => typeof value === 'string'))) {
    return res.status(400).json({ error: 'Interests must be a list of text values.' });
  }
  const savedInterests: string[] = interests ?? currentUser.interests;

  // Check username collision
  const collision = users.find(
    (u) => u.username && u.username.toLowerCase() === cleanUsername && u.id !== currentUser.id
  );
  if (collision) {
    return res.status(400).json({ error: 'This username is already taken. Please pick another one.' });
  }

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const sessionToken = getSessionTokenFromRequest(req);
  const authUserId = sessionToken ? activeSessions.get(sessionToken)?.authUserId : undefined;
  const { error: profileUpdateError } = await supabase
    .from('profiles')
    .update({
      full_name: facultyDetails?.name || name.trim(),
      username: cleanUsername,
      avatar_url: typeof avatar === 'string' ? avatar : undefined,
      is_profile_completed: true,
    })
    .eq('id', authUserId || '');
  if (profileUpdateError) {
    console.error('Could not save the authenticated profile:', profileUpdateError.code);
    return res.status(500).json({ error: 'Could not save your profile. Please try again.' });
  }

  const { error: settingsError } = await supabase
    .from('app_user_settings')
    .upsert(
      {
        profile_id: currentUser.id,
        interests: savedInterests,
        ordered_preferences: currentUser.orderedPreferences || [],
        notification_preferences: currentUser.notificationPreferences,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id' }
    );
  if (settingsError) {
    console.error('Could not save profile preferences:', settingsError.code);
    return res.status(500).json({ error: 'Could not save your preferences. Please try again.' });
  }

  // Save profile
  currentUser.name = facultyDetails?.name || name.trim();
  if (facultyDetails) currentUser.designation = facultyDetails.designation;
  currentUser.username = cleanUsername;
  currentUser.isProfileCompleted = true;
  if (avatar) currentUser.avatar = avatar;

  currentUser.interests = savedInterests;

  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'PROFILE_COMPLETED',
    details: `${currentUser.role} completed first-time profile with username @${currentUser.username}`,
    timestamp: new Date().toISOString(),
  });
  await persistAuditLog(req, auditLogs[0]);

  res.json({ user: currentUser, message: 'Profile saved successfully!' });
});

// 5. Sign Out / Invalidate Session
app.post('/api/auth/logout', async (req: Request, res: Response) => {
  const token = getSessionTokenFromRequest(req);
  let sessionStoreError = false;
  if (token) {
    const session = activeSessions.get(token);
    if (session) {
      const userSupabase = createAuthenticatedSupabaseClient(session.supabaseAccessToken);
      const { data: sessionData, error: sessionError } = await userSupabase.auth.setSession({
        access_token: session.supabaseAccessToken,
        refresh_token: session.supabaseRefreshToken,
      });
      if (sessionError || !sessionData.session) {
        console.warn('Supabase session could not be restored during logout:', sessionError?.code);
      } else {
        session.supabaseAccessToken = sessionData.session.access_token;
        session.supabaseRefreshToken = sessionData.session.refresh_token;
        const refreshedClient = createAuthenticatedSupabaseClient(sessionData.session.access_token);
        const { error } = await refreshedClient.auth.signOut({ scope: 'local' });
        if (error) console.warn('Supabase sign-out failed:', error.code);
      }
    }
    activeSessions.delete(token);
    if (session) {
      try {
        await deleteSessionRecord(token);
      } catch (deleteError) {
        sessionStoreError = true;
        console.error('Could not delete the persistent session during logout:', deleteError);
      }
    }
  }
  setSessionCookie(res, '', 0);
  if (sessionStoreError) {
    return res.status(503).json({
      error: 'Your session was signed out here, but could not be removed from persistent storage.',
    });
  }
  res.json({ success: true, message: 'Signed out successfully.' });
});

// 6. Get Current Auth Session
app.get('/api/auth/session', async (req: Request, res: Response) => {
  const user = getStrictAuthenticatedUser(req);
  if (!user) {
    return res.json({ authenticated: false, user: null });
  }
  const token = getSessionTokenFromRequest(req);
  try {
    await getSupabaseClientForRequest(req);
  } catch (refreshErr) {
    console.warn('Could not refresh Supabase client on session check, continuing with user session:', refreshErr);
  }
  const matchingDivisions = DIVISIONS.filter((d) => user.divisionIds?.includes(d.id));
  res.json({ authenticated: true, user, token: token || undefined, divisions: matchingDivisions });
});

// 7. Get College Divisions
app.get('/api/divisions', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase
    .from('divisions')
    .select('id, institution_id, department_id, code, name, academic_year, status, description')
    .eq('institution_id', currentUser.institutionId)
    .order('name');
  if (error) {
    console.error('Could not load divisions from Supabase:', error.code);
    return res.status(503).json({ error: 'Could not load college divisions. Please try again later.' });
  }
  const divisionRows: Division[] = data.map((division: {
    id: string;
    department_id: string | null;
    name: string;
    code: string;
    academic_year: string;
    status: string;
    description: string | null;
  }) => ({
    id: division.id,
    name: division.name,
    code: division.code,
    academicYear: division.academic_year,
    department:
      departments.find((department) => department.id === division.department_id)?.name || '',
    status: division.status === 'archived' ? 'archived' : 'active',
    description: division.description || '',
  }));
  res.json({ divisions: divisionRows });
});

// 8. Admin: Get Approved Student Roster & Division Report
app.get('/api/admin/approved-students', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (!currentUser || currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative privileges required to inspect approved student roster.' });
  }

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }

  const [
    { data: studentRows, error: studentsError },
    { data: divisionRows, error: divisionsError },
  ] = await Promise.all([
    supabase
      .from('approved_students')
      .select('*')
      .eq('institution_id', currentUser.institutionId)
      .order('email'),
    supabase
      .from('approved_student_divisions')
      .select('student_email, division_id'),
  ]);
  if (studentsError || divisionsError) {
    const errorCode = studentsError?.code || divisionsError?.code;
    console.error('Could not load the approved student roster from Supabase:', errorCode);
    return res.status(503).json({ error: 'Could not load the approved student roster. Please try again later.' });
  }

  const divisionsByEmail = new Map<string, string[]>();
  for (const row of divisionRows) {
    const email = normalizeEmail(row.student_email);
    const memberships = divisionsByEmail.get(email) || [];
    memberships.push(row.division_id);
    divisionsByEmail.set(email, memberships);
  }
  const allStudents: ApprovedStudent[] = studentRows.map((row: {
    email: string;
    status: string;
    registered_user_id: string | null;
    registered_at: string | null;
    created_at?: string;
    updated_at?: string;
  }) => ({
    email: normalizeEmail(row.email),
    divisionIds: divisionsByEmail.get(normalizeEmail(row.email)) || [],
    status: row.status === 'revoked' ? 'revoked' : 'authorized',
    isRegistered: Boolean(row.registered_user_id),
    ...(row.registered_user_id ? { registeredUserId: row.registered_user_id } : {}),
    ...(users.find((user) => user.id === row.registered_user_id)
      ? (() => {
          const registeredUser = users.find((user) => user.id === row.registered_user_id);
          return {
            registeredName: registeredUser?.name,
            registeredUsername: registeredUser?.username,
          };
        })()
      : {}),
    createdAt: row.created_at || row.registered_at || row.updated_at || '',
    updatedAt: row.updated_at || row.registered_at || '',
  }));

  const search = ((req.query.search as string) || '').toLowerCase().trim();
  const divisionId = (req.query.divisionId as string) || 'all';

  let list = allStudents;

  if (divisionId !== 'all') {
    list = list.filter((s) => s.divisionIds.includes(divisionId));
  }

  if (search) {
    list = list.filter(
      (s) =>
        s.email.toLowerCase().includes(search) ||
        (s.registeredName && s.registeredName.toLowerCase().includes(search)) ||
        (s.registeredUsername && s.registeredUsername.toLowerCase().includes(search))
    );
  }

  // Dynamic live report
  const allList = allStudents;
  const report = {
    totalSuppliedDivisionA: allList.filter((s) => s.divisionIds.includes(DIVISION_IDS.a)).length,
    totalSuppliedDivisionB: allList.filter((s) => s.divisionIds.includes(DIVISION_IDS.b)).length,
    totalSuppliedEntries: allList.reduce((total, student) => total + student.divisionIds.length, 0),
    uniqueAddressesOverall: allList.length,
    sharedAddressesCount: allList.filter((s) => s.divisionIds.length > 1).length,
    sharedAddresses: allList.filter((s) => s.divisionIds.length > 1).map((s) => s.email).sort(),
    divisionAOnlyCount: allList.filter((s) => s.divisionIds.includes(DIVISION_IDS.a) && !s.divisionIds.includes(DIVISION_IDS.b)).length,
    divisionBOnlyCount: allList.filter((s) => s.divisionIds.includes(DIVISION_IDS.b) && !s.divisionIds.includes(DIVISION_IDS.a)).length,
    malformedAddresses: [],
    registeredCount: allList.filter((s) => s.isRegistered).length,
    pendingActivationCount: allList.filter((s) => !s.isRegistered).length,
  };

  res.json({ students: list, report, total: list.length });
});

// 9. Admin: Add New Approved Student Email
app.post('/api/admin/approved-students', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (!currentUser || currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative privileges required.' });
  }

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }

  const { email, divisionIds } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Student email is required.' });
  }

  const norm = normalizeEmail(email);
  if (!isValidEmailFormat(norm)) {
    return res.status(400).json({ error: 'Invalid email address format.' });
  }

  if (
    !Array.isArray(divisionIds) ||
    divisionIds.length === 0 ||
    !divisionIds.every((id: unknown) => typeof id === 'string')
  ) {
    return res.status(400).json({ error: 'At least one division must be assigned.' });
  }

  const uniqueDivisionIds = Array.from(new Set(divisionIds as string[]));
  const { data: validDivisions, error: validDivisionsError } = await supabase
    .from('divisions')
    .select('id')
    .eq('institution_id', currentUser.institutionId)
    .in('id', uniqueDivisionIds);
  if (validDivisionsError) {
    console.error('Could not validate approved student divisions:', validDivisionsError.code);
    return res.status(503).json({ error: 'Could not validate the selected divisions. Please try again.' });
  }
  if (validDivisions.length !== uniqueDivisionIds.length) {
    return res.status(400).json({ error: 'One or more selected divisions are not available in your institution.' });
  }

  const now = new Date().toISOString();
  const { data: savedStudent, error: studentError } = await supabase.rpc(
    'mycollege_admin_save_approved_student',
    {
      p_email: norm,
      p_division_ids: uniqueDivisionIds,
      p_status: 'authorized',
      p_new_email: null,
      p_replace_divisions: false,
      p_allow_create: true,
    }
  );
  if (studentError || !savedStudent) {
    console.error('Could not authorize approved student in Supabase:', studentError?.code);
    return res.status(503).json({ error: 'Could not authorize this student. Please try again.' });
  }

  const savedRosterEntry = savedStudent as {
    email: string;
    status: 'authorized' | 'revoked';
    registered_user_id: string | null;
    registered_at: string | null;
    updated_at: string | null;
    division_ids: string[];
  };
  const student: ApprovedStudent = {
    email: savedRosterEntry.email,
    divisionIds: savedRosterEntry.division_ids,
    status: savedRosterEntry.status,
    isRegistered: Boolean(savedRosterEntry.registered_user_id),
    ...(savedRosterEntry.registered_user_id
      ? { registeredUserId: savedRosterEntry.registered_user_id }
      : {}),
    createdAt: savedRosterEntry.registered_at || savedRosterEntry.updated_at || now,
    updatedAt: savedRosterEntry.updated_at || now,
  };
  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'APPROVED_STUDENT_ADDED',
    details: `Admin authorized ${norm} for divisions: ${divisionIds.join(', ')}`,
    timestamp: now,
  });
  await persistAuditLog(req, auditLogs[0]);

  res.status(201).json({
    student,
    message: `Student ${norm} successfully authorized.`,
  });
});

// 10. Admin: Update Approved Student (toggle status, change division, or correct email)
app.put('/api/admin/approved-students/:email', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (!currentUser || currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative privileges required.' });
  }

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }

  const norm = normalizeEmail(req.params.email);
  const { data: currentStudent, error: studentLoadError } = await supabase
    .from('approved_students')
    .select('*')
    .eq('institution_id', currentUser.institutionId)
    .eq('email', norm)
    .maybeSingle();
  if (studentLoadError) {
    console.error('Could not load approved student for update:', studentLoadError.code);
    return res.status(503).json({ error: 'Could not load this student record. Please try again.' });
  }
  if (!currentStudent) {
    return res.status(404).json({ error: 'Student email not found in approved roster.' });
  }

  const { divisionIds, status, newEmail } = req.body;
  const now = new Date().toISOString();
  let replacementDivisionIds: string[] | null = null;

  if (divisionIds !== undefined) {
    if (
      !Array.isArray(divisionIds) ||
      divisionIds.length === 0 ||
      !divisionIds.every((id: unknown) => typeof id === 'string')
    ) {
      return res.status(400).json({ error: 'At least one valid division must be assigned.' });
    }
    replacementDivisionIds = Array.from(new Set(divisionIds as string[]));
    const { data: validDivisions, error: validDivisionsError } = await supabase
      .from('divisions')
      .select('id')
      .eq('institution_id', currentUser.institutionId)
      .in('id', replacementDivisionIds);
    if (validDivisionsError) {
      console.error('Could not validate approved student divisions:', validDivisionsError.code);
      return res.status(503).json({ error: 'Could not validate the selected divisions. Please try again.' });
    }
    if (validDivisions.length !== replacementDivisionIds.length) {
      return res.status(400).json({ error: 'One or more selected divisions are not available in your institution.' });
    }
  }

  if (status !== undefined && status !== 'authorized' && status !== 'revoked') {
    return res.status(400).json({ error: 'Student status must be authorized or revoked.' });
  }

  let cleanNewEmail: string | null = null;
  if (newEmail && typeof newEmail === 'string') {
    cleanNewEmail = normalizeEmail(newEmail);
    if (!isValidEmailFormat(cleanNewEmail)) {
      return res.status(400).json({ error: 'New email format is invalid.' });
    }
  }

  const { data: savedStudent, error: updateError } = await supabase.rpc(
    'mycollege_admin_save_approved_student',
    {
      p_email: norm,
      p_division_ids: replacementDivisionIds,
      p_status: status || currentStudent.status,
      p_new_email: cleanNewEmail,
      p_replace_divisions: replacementDivisionIds !== null,
    }
  );
  if (updateError || !savedStudent) {
    console.error('Could not update approved student in Supabase:', updateError?.code);
    return res.status(503).json({ error: 'Could not update this student record. Please try again.' });
  }

  const savedRosterEntry = savedStudent as {
    email: string;
    status: 'authorized' | 'revoked';
    registered_user_id: string | null;
    registered_at: string | null;
    updated_at: string | null;
    division_ids: string[];
  };
  const student: ApprovedStudent = {
    email: normalizeEmail(savedRosterEntry.email),
    divisionIds: savedRosterEntry.division_ids,
    status: savedRosterEntry.status,
    isRegistered: Boolean(savedRosterEntry.registered_user_id),
    ...(savedRosterEntry.registered_user_id
      ? { registeredUserId: savedRosterEntry.registered_user_id }
      : {}),
    createdAt: savedRosterEntry.registered_at || savedRosterEntry.updated_at || now,
    updatedAt: savedRosterEntry.updated_at || now,
  };

  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'APPROVED_STUDENT_MODIFIED',
    details: `Admin modified approved student record for ${norm}`,
    timestamp: now,
  });
  await persistAuditLog(req, auditLogs[0]);

  res.json({ student, message: 'Student record updated.' });
});

// Current User Profile Endpoint
app.get('/api/me', (req: Request, res: Response) => {
  const user = getCurrentUser(req);
  res.json({ user });
});

app.get('/api/users', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;
  if (institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot access users from another institution.' });
  }

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }

  const adminDb = createSupabaseAdminClient() || supabase;
  let directoryRows: any[] = [];

  try {
    const { data, error } = await supabase.rpc('mycollege_list_institution_users', {
      p_institution_id: institutionId,
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      directoryRows = data;
    }
  } catch (rpcErr) {
    console.warn('mycollege_list_institution_users RPC check failed, falling back to direct profiles query:', rpcErr);
  }

  // Fallback: If RPC returned nothing or failed, query profiles table directly
  if (directoryRows.length === 0) {
    const { data: pRows, error: pError } = await adminDb
      .from('profiles')
      .select('*')
      .eq('institution_id', institutionId)
      .order('full_name', { ascending: true });

    if (pError) {
      console.error('Could not load profiles fallback in user directory:', pError.code);
      return res.status(503).json({
        error: 'Could not load the user directory. Apply the latest user-directory migration and try again.',
      });
    }

    directoryRows = (pRows || []).map((p: any) => ({
      id: p.id,
      institution_id: p.institution_id,
      full_name: p.full_name,
      email: p.email,
      role: p.role,
      department_id: p.department_id,
      designation: p.designation,
      username: p.username,
      phone: p.phone,
      avatar_url: p.avatar_url,
      is_verified: p.is_verified,
      is_profile_completed: p.is_profile_completed,
      terms_accepted_at: p.terms_accepted_at,
      division_ids: [],
      roll_no: p.roll_no,
      academic_year: p.year,
      course: p.course,
    }));
  }

  const directoryUsers: User[] = directoryRows.map((row) => {
    const cachedUser = users.find((candidate) => candidate.id === row.id || candidate.email.toLowerCase() === row.email.toLowerCase());
    const departmentId = row.department_id || cachedUser?.departmentId || '';
    const divisionIds = row.division_ids || cachedUser?.divisionIds || [];
    const role = row.role === 'teacher' ? 'faculty' : row.role;

    return {
      ...(cachedUser || {
        id: row.id,
        institutionId: row.institution_id,
        name: row.full_name || row.email.split('@')[0],
        email: row.email,
        role: role as UserRole,
        departmentId,
        interests: ['Academics'],
        notificationPreferences: {
          academic: true,
          events: true,
          deadlines: true,
          clubs: true,
        },
        isVerified: row.is_verified,
      }),
      id: row.id,
      institutionId: row.institution_id,
      name: row.full_name || cachedUser?.name || row.email.split('@')[0],
      email: row.email,
      role: role as UserRole,
      departmentId,
      departmentName:
        departments.find((department) => department.id === departmentId)?.name ||
        cachedUser?.departmentName,
      designation: row.designation || cachedUser?.designation,
      username: row.username || cachedUser?.username,
      phone: row.phone || cachedUser?.phone,
      avatar: row.avatar_url || cachedUser?.avatar,
      isVerified: row.is_verified,
      isProfileCompleted: row.is_profile_completed,
      termsAcceptedAt: row.terms_accepted_at || undefined,
      rollNo: row.roll_no || cachedUser?.rollNo,
      year: row.academic_year || cachedUser?.year,
      course: row.course || cachedUser?.course,
      divisionIds,
      divisionNames: DIVISIONS.filter((division) => divisionIds.includes(division.id)).map(
        (division) => division.name
      ),
      division: DIVISIONS.filter((division) => divisionIds.includes(division.id))
        .map((division) => division.name)
        .join(' & '),
    };
  });

  res.json({ users: directoryUsers });
});

app.post('/api/users', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Only institutional administrators can register new accounts.' });
  }

  return res.status(409).json({
    error:
      'Accounts must be provisioned from trusted records. Add students in the Approved Roster with their division assignments, or add faculty to the authorized faculty directory. The person can then sign in with email OTP.',
  });
});

app.put('/api/users/:id/role', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative privileges required to modify user roles.' });
  }

  const { role } = req.body as { role?: unknown };
  if (
    typeof role !== 'string' ||
    !['student', 'faculty', 'coordinator', 'admin'].includes(role)
  ) {
    return res.status(400).json({ error: 'Select a supported user role.' });
  }
  if (req.params.id === currentUser.id) {
    return res.status(400).json({ error: 'Administrators cannot change their own role.' });
  }

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }

  const adminDb = createSupabaseAdminClient() || supabase;
  let updatedProfile: any = null;

  try {
    const { data, error } = await supabase.rpc('mycollege_admin_update_profile_role', {
      p_profile_id: req.params.id,
      p_role: role,
    });
    if (!error && data) {
      updatedProfile = data;
    }
  } catch (rpcErr) {
    console.warn('mycollege_admin_update_profile_role RPC failed, using direct admin update:', rpcErr);
  }

  // Reliable fallback: Direct update via adminDb
  if (!updatedProfile) {
    const { data: directData, error: directErr } = await adminDb
      .from('profiles')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*')
      .single();

    if (directErr || !directData) {
      console.error('Direct role update failed:', directErr);
      return res.status(503).json({ error: 'Could not update user role. Please try again.' });
    }
    updatedProfile = directData;
  }

  // Also update approved_students table if student
  try {
    await adminDb
      .from('approved_students')
      .update({ role })
      .eq('email', updatedProfile.email);
  } catch {}

  // Update in-memory user cache
  const targetUser = users.find((u) => u.id === req.params.id || u.email.toLowerCase() === updatedProfile.email.toLowerCase());
  if (targetUser) {
    targetUser.role = updatedProfile.role;
  }

  const updatedUser: User = {
    ...(targetUser || {
      id: updatedProfile.id,
      institutionId: updatedProfile.institution_id,
      name: updatedProfile.full_name || updatedProfile.email.split('@')[0],
      email: updatedProfile.email,
      role: updatedProfile.role,
      departmentId: updatedProfile.department_id || '',
      interests: ['Academics'],
      notificationPreferences: {
        academic: true,
        events: true,
        deadlines: true,
        clubs: true,
      },
      isVerified: updatedProfile.is_verified,
    }),
    id: updatedProfile.id,
    institutionId: updatedProfile.institution_id,
    name: updatedProfile.full_name || targetUser?.name || updatedProfile.email.split('@')[0],
    email: updatedProfile.email,
    role: updatedProfile.role,
    departmentId: updatedProfile.department_id || targetUser?.departmentId || '',
    departmentName:
      departments.find((department) => department.id === updatedProfile.department_id)?.name ||
      targetUser?.departmentName,
    designation: updatedProfile.designation || targetUser?.designation,
    username: updatedProfile.username || targetUser?.username,
    avatar: updatedProfile.avatar_url || targetUser?.avatar,
    isVerified: updatedProfile.is_verified,
    isProfileCompleted: updatedProfile.is_profile_completed,
    termsAcceptedAt: updatedProfile.terms_accepted_at || undefined,
  };
  const cachedUserIndex = users.findIndex((user) => user.id === updatedUser.id);
  if (cachedUserIndex === -1) users.push(updatedUser);
  else users[cachedUserIndex] = updatedUser;

  for (const [token, session] of activeSessions) {
    if (session.userId === updatedUser.id) activeSessions.delete(token);
  }

  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'USER_ROLE_UPDATED',
    details: `Updated role of ${updatedUser.name} to ${role}`,
    timestamp: new Date().toISOString(),
  });
  await persistAuditLog(req, auditLogs[0]);

  res.json({ user: updatedUser });
});

// Update user preferences & interests
app.put('/api/me/preferences', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const { interests, notificationPreferences, orderedPreferences } = req.body;

  if (interests !== undefined && (!Array.isArray(interests) || !interests.every((value) => typeof value === 'string'))) {
    return res.status(400).json({ error: 'Interests must be a list of text values.' });
  }
  if (
    orderedPreferences !== undefined &&
    (!Array.isArray(orderedPreferences) ||
      orderedPreferences.length !== 3 ||
      !orderedPreferences.every((value) => typeof value === 'string') ||
      new Set(orderedPreferences).size !== 3)
  ) {
    return res.status(400).json({ error: 'Choose three distinct ordered preferences.' });
  }
  if (
    notificationPreferences !== undefined &&
    (!notificationPreferences ||
      typeof notificationPreferences !== 'object' ||
      Array.isArray(notificationPreferences) ||
      Object.entries(notificationPreferences).some(
        ([key, value]) =>
          !['academic', 'events', 'deadlines', 'clubs'].includes(key) ||
          typeof value !== 'boolean'
      ))
  ) {
    return res.status(400).json({ error: 'Notification preferences contain invalid values.' });
  }

  const updatedInterests: string[] = interests ?? currentUser.interests;
  const updatedOrderedPreferences: [string, string, string] =
    orderedPreferences ?? currentUser.orderedPreferences ?? ['Technical Events', 'Sports', 'Academics'];
  const updatedNotificationPreferences: UserNotificationPreferences = {
    ...currentUser.notificationPreferences,
    ...notificationPreferences,
  };
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { error } = await supabase
    .from('app_user_settings')
    .upsert(
      {
        profile_id: currentUser.id,
        interests: updatedInterests,
        ordered_preferences: updatedOrderedPreferences,
        notification_preferences: updatedNotificationPreferences,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id' }
    );
  if (error) {
    console.error('Could not save persisted user preferences:', error.code);
    return res.status(500).json({ error: 'Could not save your preferences. Please try again.' });
  }

  currentUser.interests = updatedInterests;
  currentUser.orderedPreferences = updatedOrderedPreferences;
  currentUser.notificationPreferences = updatedNotificationPreferences;
  res.json({ user: currentUser });
});

// 2. Institutions & Multi-tenancy
app.get('/api/institutions', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase
    .from('institutions')
    .select('id, name, short_name, domain, allowed_domains, require_approval, city, established')
    .eq('id', currentUser.institutionId)
    .maybeSingle();
  if (error) {
    console.error('Could not load institution from Supabase:', error.code);
    return res.status(503).json({ error: 'Could not load your institution. Please try again later.' });
  }
  if (!data) return res.status(404).json({ error: 'Institution not found.' });
  const institution: Institution = {
    id: data.id,
    name: data.name,
    shortName: data.short_name,
    domain: data.domain,
    allowedDomains: data.allowed_domains,
    requireApproval: data.require_approval,
    city: data.city,
    established: String(data.established),
  };
  res.json({ institutions: [institution] });
});

app.get('/api/institutions/:id', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (req.params.id !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot view another institution.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase
    .from('institutions')
    .select('id, name, short_name, domain, allowed_domains, require_approval, city, established')
    .eq('id', currentUser.institutionId)
    .maybeSingle();
  if (error) {
    console.error('Could not load institution from Supabase:', error.code);
    return res.status(503).json({ error: 'Could not load your institution. Please try again later.' });
  }
  if (!data) return res.status(404).json({ error: 'Institution not found.' });
  const institution: Institution = {
    id: data.id,
    name: data.name,
    shortName: data.short_name,
    domain: data.domain,
    allowedDomains: data.allowed_domains,
    requireApproval: data.require_approval,
    city: data.city,
    established: String(data.established),
  };
  res.json({ institution });
});

app.put('/api/institutions/:id/settings', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Only administrators can update institutional settings.' });
  }
  if (req.params.id !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution.' });
  }

  const { requireApproval, allowedDomains } = req.body;
  if (
    (requireApproval !== undefined && typeof requireApproval !== 'boolean') ||
    (allowedDomains !== undefined &&
      (!Array.isArray(allowedDomains) || !allowedDomains.every((domain) => typeof domain === 'string')))
  ) {
    return res.status(400).json({ error: 'Institution settings contain invalid values.' });
  }
  if (requireApproval === undefined && allowedDomains === undefined) {
    return res.status(400).json({ error: 'Provide at least one setting to update.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const updates: { require_approval?: boolean; allowed_domains?: string[] } = {};
  if (requireApproval !== undefined) updates.require_approval = requireApproval;
  if (allowedDomains !== undefined) updates.allowed_domains = allowedDomains;
  const { data, error } = await supabase
    .from('institutions')
    .update(updates)
    .eq('id', currentUser.institutionId)
    .select('id, name, short_name, domain, allowed_domains, require_approval, city, established')
    .maybeSingle();
  if (error) {
    console.error('Could not save institution settings:', error.code);
    return res.status(500).json({ error: 'Could not save institution settings. Please try again.' });
  }
  if (!data) return res.status(404).json({ error: 'Institution not found.' });
  const inst: Institution = {
    id: data.id,
    name: data.name,
    shortName: data.short_name,
    domain: data.domain,
    allowedDomains: data.allowed_domains,
    requireApproval: data.require_approval,
    city: data.city,
    established: String(data.established),
  };
  const cachedInstitutionIndex = institutions.findIndex((institution) => institution.id === inst.id);
  if (cachedInstitutionIndex >= 0) institutions[cachedInstitutionIndex] = inst;

  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: inst.id,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'INSTITUTION_SETTINGS_UPDATED',
    details: `Updated institutional governance settings: requireApproval=${inst.requireApproval}, allowedDomains=${inst.allowedDomains.join(',')}`,
    timestamp: new Date().toISOString(),
  });
  await persistAuditLog(req, auditLogs[0]);

  res.json({ institution: inst });
});

// 3. Departments
app.get('/api/departments', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;
  if (institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot view departments from another institution.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase
    .from('departments')
    .select('id, institution_id, name, code, courses')
    .eq('institution_id', currentUser.institutionId)
    .order('name');
  if (error) {
    console.error('Could not load departments from Supabase:', error.code);
    return res.status(503).json({ error: 'Could not load college departments. Please try again later.' });
  }
  const departmentRows: Department[] = data.map((department: {
    id: string;
    institution_id: string;
    name: string;
    code: string;
    courses: string[] | null;
  }) => ({
    id: department.id,
    institutionId: department.institution_id,
    name: department.name,
    code: department.code,
    courses: department.courses || [],
  }));
  res.json({ departments: departmentRows });
});

app.post('/api/departments', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin permission required.' });
  }

  const { name, code, courses } = req.body;
  if (typeof name !== 'string' || !name.trim() || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'Name and Code are required.' });
  }
  if (courses !== undefined && (!Array.isArray(courses) || !courses.every((course) => typeof course === 'string'))) {
    return res.status(400).json({ error: 'Courses must be a list of text values.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase
    .from('departments')
    .insert({
      institution_id: currentUser.institutionId,
      name: name.trim(),
      code: code.trim().toUpperCase(),
      courses: courses || [],
    })
    .select('id, institution_id, name, code, courses')
    .single();
  if (error) {
    console.error('Could not create department in Supabase:', error.code);
    return res.status(500).json({ error: 'Could not create the department. Please try again.' });
  }
  const newDept: Department = {
    id: data.id,
    institutionId: data.institution_id,
    name: data.name,
    code: data.code,
    courses: data.courses || [],
  };
  departments.push(newDept);
  res.status(201).json({ department: newDept });
});

interface AnnouncementDbRow {
  id: string;
  institution_id: string;
  author_id: string;
  author_name: string | null;
  author_role: string | null;
  title: string;
  description: string;
  category: string;
  publishing_department: string | null;
  audience_type: string;
  audience_data: { courses?: string[]; years?: string[] } | null;
  priority: string;
  status: string;
  publication_date: string;
  expiry_date: string | null;
  event_date: string | null;
  event_location: string | null;
  registration_deadline: string | null;
  registration_link: string | null;
  is_pinned: boolean;
  is_official: boolean;
  ai_summary: string | null;
  image_banner: string | null;
}

interface AnnouncementAttachmentDbRow {
  id: string;
  announcement_id: string;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  file_size_bytes: number | null;
}

interface AnnouncementDepartmentDbRow {
  announcement_id: string;
  department_id: string;
}

interface AnnouncementMetricsDbRow {
  announcement_id: string;
  views: number;
  saves: number;
  registrations: number;
}

function formatAttachmentSize(bytes: number | null): string {
  if (!bytes || bytes < 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadAnnouncementsFromSupabase(
  supabase: Awaited<ReturnType<typeof getSupabaseClientForRequest>>,
  rows: AnnouncementDbRow[]
): Promise<Announcement[]> {
  if (!supabase || rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [attachmentsResult, departmentsResult, metricsResult] = await Promise.all([
    supabase
      .from('announcement_attachments')
      .select('id, announcement_id, file_name, storage_path, content_type, file_size_bytes')
      .in('announcement_id', ids),
    supabase
      .from('announcement_departments')
      .select('announcement_id, department_id')
      .in('announcement_id', ids),
    supabase.rpc('mycollege_announcement_metrics', { requested_ids: ids }),
  ]);
  if (attachmentsResult.error || departmentsResult.error || metricsResult.error) {
    const errorCode =
      attachmentsResult.error?.code ||
      departmentsResult.error?.code ||
      metricsResult.error?.code;
    console.error('Could not load announcement details from Supabase:', errorCode);
    throw new Error('Could not load announcement details from the database.');
  }
  const attachmentsByAnnouncement = new Map<string, AnnouncementAttachment[]>();
  for (const attachment of (attachmentsResult.data || []) as AnnouncementAttachmentDbRow[]) {
    const list = attachmentsByAnnouncement.get(attachment.announcement_id) || [];
    list.push({
      id: attachment.id,
      name: attachment.file_name,
      size: formatAttachmentSize(attachment.file_size_bytes),
      type: attachment.content_type || 'application/octet-stream',
      url: attachment.storage_path,
    });
    attachmentsByAnnouncement.set(attachment.announcement_id, list);
  }
  const departmentsByAnnouncement = new Map<string, string[]>();
  for (const row of (departmentsResult.data || []) as AnnouncementDepartmentDbRow[]) {
    const list = departmentsByAnnouncement.get(row.announcement_id) || [];
    list.push(row.department_id);
    departmentsByAnnouncement.set(row.announcement_id, list);
  }
  const metricsByAnnouncement = new Map<string, AnnouncementMetricsDbRow>();
  for (const metrics of (metricsResult.data || []) as AnnouncementMetricsDbRow[]) {
    metricsByAnnouncement.set(metrics.announcement_id, metrics);
  }
  return rows.map((row) => ({
    id: row.id,
    institutionId: row.institution_id,
    title: row.title,
    description: row.description,
    category: row.category as AnnouncementCategory,
    publishingDepartment: row.publishing_department || 'College',
    authorId: row.author_id,
    authorName: row.author_name || 'College staff',
    authorRole: (row.author_role === 'teacher' ? 'faculty' : row.author_role || 'faculty') as UserRole,
    targetAudience: {
      type: (row.audience_type === 'division' ? 'all' : row.audience_type) as 'all' | 'department' | 'course' | 'year',
      departmentIds: departmentsByAnnouncement.get(row.id) || [],
      courses: row.audience_data?.courses || [],
      years: row.audience_data?.years || [],
    },
    priority: row.priority as PriorityLevel,
    status: row.status as AnnouncementStatus,
    publicationDate: row.publication_date,
    expiryDate: row.expiry_date || undefined,
    eventDate: row.event_date || undefined,
    eventLocation: row.event_location || undefined,
    registrationDeadline: row.registration_deadline || undefined,
    registrationLink: row.registration_link || undefined,
    attachments: attachmentsByAnnouncement.get(row.id) || [],
    isPinned: row.is_pinned,
    isOfficial: row.is_official,
    aiSummary: row.ai_summary || undefined,
    imageBanner: row.image_banner || undefined,
    metrics: {
      views: metricsByAnnouncement.get(row.id)?.views || 0,
      saves: metricsByAnnouncement.get(row.id)?.saves || 0,
      registrations: metricsByAnnouncement.get(row.id)?.registrations || 0,
    },
  }));
}

function attachmentSizeInBytes(size: string): number | null {
  const match = size.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
  if (!match) return null;
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
  };
  return Math.round(Number(match[1]) * multipliers[match[2].toUpperCase()]);
}

async function persistAnnouncementChildren(
  supabase: any,
  announcementId: string,
  targetAudience: Announcement['targetAudience'],
  attachments: AnnouncementAttachment[]
): Promise<string | null> {
  const departmentRows = (targetAudience.departmentIds || []).map((departmentId) => ({
    announcement_id: announcementId,
    department_id: departmentId,
  }));
  if (departmentRows.length > 0) {
    const { error } = await supabase.from('announcement_departments').insert(departmentRows);
    if (error) return error.code || 'ANNOUNCEMENT_DEPARTMENTS_SAVE_FAILED';
  }
  const attachmentRows = attachments.map((attachment) => ({
    announcement_id: announcementId,
    file_name: attachment.name,
    storage_path: attachment.url,
    content_type: attachment.type || null,
    file_size_bytes: attachmentSizeInBytes(attachment.size),
  }));
  if (attachmentRows.length > 0) {
    const { error } = await supabase.from('announcement_attachments').insert(attachmentRows);
    if (error) return error.code || 'ANNOUNCEMENT_ATTACHMENTS_SAVE_FAILED';
  }
  return null;
}

// 4. Announcements
app.get('/api/announcements', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;
  if (institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot view announcements from another institution.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const category = req.query.category as string;
  const priority = req.query.priority as string;
  const search = (req.query.search as string || '').toLowerCase().trim();
  const sort = (req.query.sort as string) || 'relevant'; // relevant | latest | urgent | deadlines

  const adminDb = createSupabaseAdminClient() || supabase;
  // Multi-tenant isolation: Only announcements for this institution
  const { data, error } = await adminDb
    .from('announcements')
    .select('*')
    .eq('institution_id', institutionId)
    .order('publication_date', { ascending: false });
  if (error) {
    console.error('Could not load announcements from Supabase:', error.code);
    return res.status(503).json({ error: 'Could not load announcements. Please try again later.' });
  }
  let result: Announcement[];
  try {
    result = await loadAnnouncementsFromSupabase(adminDb, (data || []) as AnnouncementDbRow[]);
  } catch {
    return res.status(503).json({ error: 'Could not load announcement details. Please try again later.' });
  }

  // Role visibility check:
  // Students ONLY see published announcements.
  // Faculty/Coordinators see published announcements + their own pending/drafts.
  // Admins see all announcements including pending_approval.
  if (currentUser.role === 'student') {
    result = result.filter((a) => a.status === 'published' && canUserViewAnnouncement(currentUser, a));
  } else if (currentUser.role === 'faculty' || currentUser.role === 'coordinator') {
    result = result.filter(
      (a) => (a.status === 'published' && canUserViewAnnouncement(currentUser, a)) || a.authorId === currentUser.id
    );
  }

  // Filter category
  if (category && category !== 'all') {
    result = result.filter((a) => a.category === category);
  }

  // Filter priority
  if (priority && priority !== 'all') {
    result = result.filter((a) => a.priority === priority);
  }

  // Full-text search across Title, Description, Department, Category, Event
  if (search) {
    result = result.filter(
      (a) =>
        a.title.toLowerCase().includes(search) ||
        a.description.toLowerCase().includes(search) ||
        a.publishingDepartment.toLowerCase().includes(search) ||
        a.category.toLowerCase().includes(search) ||
        (a.eventLocation && a.eventLocation.toLowerCase().includes(search)) ||
        (a.authorName && a.authorName.toLowerCase().includes(search))
    );
  }

  // Smart Feed Ranking & Sorting
  const now = new Date().getTime();
  if (sort === 'latest') {
    result.sort((a, b) => new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime());
  } else if (sort === 'urgent') {
    const priorityWeight: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 };
    result.sort((a, b) => (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0));
  } else if (sort === 'deadlines') {
    result.sort((a, b) => {
      const dA = a.registrationDeadline ? new Date(a.registrationDeadline).getTime() : Infinity;
      const dB = b.registrationDeadline ? new Date(b.registrationDeadline).getTime() : Infinity;
      return dA - dB;
    });
  } else {
    // 'relevant' default smart ranking:
    // 1. Pinned items at top
    // 2. Urgent items
    // 3. Department / Course match score
    // 4. Interests match score
    // 5. Recency
    result.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;

      const priorityWeight: Record<string, number> = { urgent: 40, high: 20, normal: 5, low: 0 };
      let scoreA = priorityWeight[a.priority] || 0;
      let scoreB = priorityWeight[b.priority] || 0;

      // Department relevance bonus
      if (
        a.targetAudience.type === 'all' ||
        (a.targetAudience.departmentIds && a.targetAudience.departmentIds.includes(currentUser.departmentId))
      ) {
        scoreA += 15;
      }
      if (
        b.targetAudience.type === 'all' ||
        (b.targetAudience.departmentIds && b.targetAudience.departmentIds.includes(currentUser.departmentId))
      ) {
        scoreB += 15;
      }

      // Student interests match bonus
      if (currentUser.interests && currentUser.interests.some((i) => a.category.toLowerCase().includes(i.toLowerCase()))) {
        scoreA += 10;
      }
      if (currentUser.interests && currentUser.interests.some((i) => b.category.toLowerCase().includes(i.toLowerCase()))) {
        scoreB += 10;
      }

      // Active deadline boost (if within next 7 days)
      if (a.registrationDeadline) {
        const diffDaysA = (new Date(a.registrationDeadline).getTime() - now) / (1000 * 3600 * 24);
        if (diffDaysA > 0 && diffDaysA <= 7) scoreA += 12;
      }
      if (b.registrationDeadline) {
        const diffDaysB = (new Date(b.registrationDeadline).getTime() - now) / (1000 * 3600 * 24);
        if (diffDaysB > 0 && diffDaysB <= 7) scoreB += 12;
      }

      if (scoreA !== scoreB) return scoreB - scoreA;
      return new Date(b.publicationDate).getTime() - new Date(a.publicationDate).getTime();
    });
  }

  res.json({ announcements: result });
});

// Single announcement details
app.get('/api/announcements/:id', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', req.params.id)
    .eq('institution_id', currentUser.institutionId)
    .maybeSingle();
  if (error) {
    console.error('Could not load announcement from Supabase:', error.code);
    return res.status(503).json({ error: 'Could not load the announcement. Please try again later.' });
  }
  if (!data) return res.status(404).json({ error: 'Announcement not found.' });
  let item: Announcement;
  try {
    [item] = await loadAnnouncementsFromSupabase(supabase, [data as AnnouncementDbRow]);
  } catch {
    return res.status(503).json({ error: 'Could not load announcement details. Please try again later.' });
  }
  const { error: viewError } = await supabase.from('announcement_views').insert({
    profile_id: currentUser.id,
    announcement_id: item.id,
  });
  if (viewError) {
    console.error('Could not record announcement view:', viewError.code);
    return res.status(500).json({ error: 'Could not record that announcement view.' });
  }
  item.metrics.views += 1;
  res.json({ announcement: item });
});

// View or Download Announcement Attachment (PDF, circular, document)
app.get('/api/announcements/:announcementId/attachments/:attachmentId/:action(view|download)', async (req: Request, res: Response) => {
  const { attachmentId, action } = req.params;
  const isDownload = action === 'download';

  const adminDb = createSupabaseAdminClient();
  let row: any = null;
  if (adminDb) {
    const { data } = await adminDb
      .from('announcement_attachments')
      .select('*')
      .eq('id', attachmentId)
      .maybeSingle();
    row = data;
  }

  if (!row || !row.storage_path) {
    return res.status(404).send('Attachment document not found.');
  }

  const fileName = row.file_name || 'document.pdf';
  const contentType = row.content_type || 'application/pdf';

  if (typeof row.storage_path === 'string') {
    let base64Data: string | null = null;
    if (row.storage_path.startsWith('data:')) {
      const base64Index = row.storage_path.indexOf('base64,');
      if (base64Index >= 0) {
        base64Data = row.storage_path.slice(base64Index + 7);
      }
    } else if (
      row.storage_path.startsWith('JVBERi0') ||
      (!row.storage_path.startsWith('http://') && !row.storage_path.startsWith('https://') && row.storage_path.length > 100)
    ) {
      base64Data = row.storage_path;
    }

    if (base64Data) {
      const fileBuffer = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', fileBuffer.length);
      res.setHeader('Access-Control-Allow-Origin', '*');
      const safeName = fileName.replace(/["\r\n]/g, '_');
      const disposition = isDownload ? 'attachment' : 'inline';
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      return res.send(fileBuffer);
    }
  }

  // If storage_path is a remote URL or Supabase storage URL, redirect
  return res.redirect(row.storage_path);
});

// Create announcement (strict role & tenant authorization)
app.post('/api/announcements', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);

  // Requirement: Enforce permissions on the backend! Students cannot publish announcements!
  if (currentUser.role === 'student') {
    return res.status(403).json({
      error: 'Permission Denied: Students are not authorized to publish official college announcements.',
    });
  }

  const {
    title,
    description,
    category,
    publishingDepartment,
    targetAudience,
    priority,
    eventDate,
    eventLocation,
    registrationDeadline,
    registrationLink,
    attachments,
    imageBanner,
    aiSummary,
  } = req.body;

  if (
    typeof title !== 'string' ||
    !title.trim() ||
    typeof description !== 'string' ||
    !description.trim() ||
    typeof category !== 'string'
  ) {
    return res.status(400).json({ error: 'Title, description, and category are mandatory.' });
  }
  const audience = targetAudience || { type: 'all' };
  if (
    !audience ||
    !['all', 'department', 'course', 'year'].includes(audience.type) ||
    (audience.departmentIds !== undefined &&
      (!Array.isArray(audience.departmentIds) ||
        !audience.departmentIds.every((id: unknown) => typeof id === 'string'))) ||
    (audience.years !== undefined &&
      (!Array.isArray(audience.years) || !audience.years.every((year: unknown) => typeof year === 'string'))) ||
    (audience.courses !== undefined &&
      (!Array.isArray(audience.courses) || !audience.courses.every((course: unknown) => typeof course === 'string')))
  ) {
    return res.status(400).json({ error: 'Announcement audience contains invalid values.' });
  }
  const cleanAttachments: AnnouncementAttachment[] = attachments === undefined ? [] : attachments;
  if (
    !Array.isArray(cleanAttachments) ||
    cleanAttachments.some((attachment) =>
      !attachment ||
      typeof attachment.name !== 'string' ||
      typeof attachment.url !== 'string' ||
      typeof attachment.type !== 'string' ||
      typeof attachment.size !== 'string'
    )
  ) {
    return res.status(400).json({ error: 'Announcement attachments contain invalid values.' });
  }
  if (priority !== undefined && !['urgent', 'high', 'normal', 'low'].includes(priority)) {
    return res.status(400).json({ error: 'Announcement priority is invalid.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const token = getSessionTokenFromRequest(req);
  const session = token ? activeSessions.get(token) : undefined;
  let authorId = session?.authUserId;
  if (!authorId) {
    const { data: authUserData } = await supabase.auth.getUser();
    authorId = authUserData?.user?.id || currentUser.id;
  }

  const adminDb = createSupabaseAdminClient() || supabase;
  const { data: institution, error: institutionError } = await adminDb
    .from('institutions')
    .select('require_approval')
    .eq('id', currentUser.institutionId)
    .maybeSingle();
  if (institutionError || !institution) {
    console.error('Could not load announcement approval settings:', institutionError?.code);
    return res.status(503).json({ error: 'Could not verify announcement approval settings.' });
  }
  const isStaff = ['admin', 'faculty', 'teacher'].includes(currentUser.role);
  const requiresApproval = Boolean(institution.require_approval && !isStaff);
  const { data: inserted, error: insertError } = await adminDb
    .from('announcements')
    .insert({
      institution_id: currentUser.institutionId,
      author_id: authorId,
      title: title.trim(),
      description: description.trim(),
      category,
      publishing_department: publishingDepartment || currentUser.departmentName || 'Department Notice',
      audience_type: audience.type,
      audience_data: {
        courses: audience.courses || [],
        years: audience.years || [],
      },
      priority: priority || 'normal',
      status: requiresApproval ? 'pending_approval' : 'published',
      event_date: eventDate || null,
      event_location: eventLocation || null,
      registration_deadline: registrationDeadline || null,
      registration_link: registrationLink || null,
      image_banner: imageBanner || null,
      ai_summary: aiSummary || null,
      is_official: isStaff,
    })
    .select('*')
    .single();
  if (insertError) {
    console.error('Could not create announcement in Supabase:', insertError.code, insertError.message, insertError.details);
    return res.status(500).json({ error: insertError.message || 'Could not create the announcement. Please try again.' });
  }
  const childError = await persistAnnouncementChildren(
    adminDb,
    inserted.id,
    audience,
    cleanAttachments
  );
  if (childError) {
    const { error: cleanupError } = await adminDb
      .from('announcements')
      .delete()
      .eq('id', inserted.id);
    if (cleanupError) {
      console.error('Announcement cleanup after a child-record failure also failed:', cleanupError.code);
    }
    console.error('Could not save announcement details:', childError);
    return res.status(500).json({ error: 'Could not save announcement departments or attachments.' });
  }
  try {
    const { error: announcementNotificationError } = await adminDb.rpc(
      'mycollege_notify_announcement',
      { target_announcement_id: inserted.id }
    );
    if (announcementNotificationError) {
      console.warn('Announcement notifications warning (non-fatal):', announcementNotificationError.code || announcementNotificationError.message);
    }
  } catch (notifErr) {
    console.warn('Could not run audience notifications:', notifErr);
  }
  let newAnnouncement: Announcement;
  try {
    [newAnnouncement] = await loadAnnouncementsFromSupabase(adminDb, [inserted as AnnouncementDbRow]);
  } catch {
    return res.status(503).json({ error: 'Announcement was saved, but its details could not be loaded.' });
  }

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'notifications:changed' });

  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: requiresApproval ? 'ANNOUNCEMENT_SUBMITTED_FOR_APPROVAL' : 'ANNOUNCEMENT_PUBLISHED',
    details: `${currentUser.role} ${currentUser.name} created announcement: "${title}" (Status: ${newAnnouncement.status})`,
    timestamp: new Date().toISOString(),
  });
  await persistAuditLog(req, auditLogs[0]);

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'announcements:changed' });
  res.status(201).json({ announcement: newAnnouncement });
});

// Edit announcement
app.put('/api/announcements/:id', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: existing, error: existingError } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', req.params.id)
    .eq('institution_id', currentUser.institutionId)
    .maybeSingle();
  if (existingError) {
    console.error('Could not load announcement before editing:', existingError.code);
    return res.status(503).json({ error: 'Could not load the announcement. Please try again later.' });
  }
  if (!existing) return res.status(404).json({ error: 'Announcement not found.' });
  if (
    existing.author_id !== currentUser.id &&
    currentUser.role !== 'admin' &&
    currentUser.role !== 'faculty'
  ) {
    return res.status(403).json({ error: 'You are not authorized to edit this announcement.' });
  }

  const updates = req.body;
  const dbUpdates: Record<string, unknown> = {};
  const simpleFields: [string, string][] = [
    ['title', 'title'],
    ['description', 'description'],
    ['category', 'category'],
    ['publishingDepartment', 'publishing_department'],
    ['priority', 'priority'],
    ['eventDate', 'event_date'],
    ['eventLocation', 'event_location'],
    ['registrationDeadline', 'registration_deadline'],
    ['registrationLink', 'registration_link'],
    ['imageBanner', 'image_banner'],
    ['aiSummary', 'ai_summary'],
    ['isPinned', 'is_pinned'],
  ];
  for (const [apiField, dbField] of simpleFields) {
    if (updates[apiField] !== undefined) {
      dbUpdates[dbField] = updates[apiField] === '' ? null : updates[apiField];
    }
  }
  const audience = updates.targetAudience;
  if (audience !== undefined) {
    if (
      !audience ||
      !['all', 'department', 'course', 'year'].includes(audience.type) ||
      (audience.departmentIds !== undefined &&
        (!Array.isArray(audience.departmentIds) ||
          !audience.departmentIds.every((id: unknown) => typeof id === 'string'))) ||
      (audience.years !== undefined &&
        (!Array.isArray(audience.years) || !audience.years.every((year: unknown) => typeof year === 'string'))) ||
      (audience.courses !== undefined &&
        (!Array.isArray(audience.courses) ||
          !audience.courses.every((course: unknown) => typeof course === 'string')))
    ) {
      return res.status(400).json({ error: 'Announcement audience contains invalid values.' });
    }
    dbUpdates.audience_type = audience.type;
    dbUpdates.audience_data = { courses: audience.courses || [], years: audience.years || [] };
  }
  const updatedAttachments = updates.attachments;
  if (
    updatedAttachments !== undefined &&
    (!Array.isArray(updatedAttachments) || updatedAttachments.some((attachment: AnnouncementAttachment) =>
      !attachment ||
      typeof attachment.name !== 'string' ||
      typeof attachment.url !== 'string' ||
      typeof attachment.type !== 'string' ||
      typeof attachment.size !== 'string'
    ))
  ) {
    return res.status(400).json({ error: 'Announcement attachments contain invalid values.' });
  }
  if (Object.keys(dbUpdates).length > 0) {
    const { error } = await supabase
      .from('announcements')
      .update(dbUpdates)
      .eq('id', req.params.id)
      .eq('institution_id', currentUser.institutionId);
    if (error) {
      console.error('Could not update announcement in Supabase:', error.code);
      return res.status(500).json({ error: 'Could not update the announcement. Please try again.' });
    }
  }
  if (audience !== undefined) {
    const { error: deleteDepartmentsError } = await supabase
      .from('announcement_departments')
      .delete()
      .eq('announcement_id', req.params.id);
    if (deleteDepartmentsError) {
      console.error('Could not replace announcement departments:', deleteDepartmentsError.code);
      return res.status(500).json({ error: 'Could not update announcement departments.' });
    }
    const departmentRows = (audience.departmentIds || []).map((departmentId: string) => ({
      announcement_id: req.params.id,
      department_id: departmentId,
    }));
    if (departmentRows.length > 0) {
      const { error } = await supabase.from('announcement_departments').insert(departmentRows);
      if (error) {
        console.error('Could not save announcement departments:', error.code);
        return res.status(500).json({ error: 'Could not update announcement departments.' });
      }
    }
  }
  if (updatedAttachments !== undefined) {
    const { error: deleteAttachmentsError } = await supabase
      .from('announcement_attachments')
      .delete()
      .eq('announcement_id', req.params.id);
    if (deleteAttachmentsError) {
      console.error('Could not replace announcement attachments:', deleteAttachmentsError.code);
      return res.status(500).json({ error: 'Could not update announcement attachments.' });
    }
    const childError = await persistAnnouncementChildren(
      supabase,
      req.params.id,
      { type: 'all' },
      updatedAttachments as AnnouncementAttachment[]
    );
    if (childError) {
      console.error('Could not update announcement details:', childError);
      return res.status(500).json({ error: 'Could not update announcement departments or attachments.' });
    }
  }
  const { data: updated, error: updatedError } = await supabase
    .from('announcements')
    .select('*')
    .eq('id', req.params.id)
    .eq('institution_id', currentUser.institutionId)
    .single();
  if (updatedError) {
    console.error('Could not reload updated announcement:', updatedError.code);
    return res.status(503).json({ error: 'Announcement was updated, but could not be reloaded.' });
  }
  let target: Announcement;
  try {
    [target] = await loadAnnouncementsFromSupabase(supabase, [updated as AnnouncementDbRow]);
  } catch {
    return res.status(503).json({ error: 'Announcement was updated, but its details could not be loaded.' });
  }

  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'ANNOUNCEMENT_EDITED',
    details: `Announcement "${target.title}" edited by ${currentUser.name}`,
    timestamp: new Date().toISOString(),
  });
  await persistAuditLog(req, auditLogs[0]);

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'announcements:changed' });
  res.json({ announcement: target });
});

// Admin Approve / Reject announcement
app.post('/api/announcements/:id/approve', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin authorization required to approve announcements.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase
    .from('announcements')
    .update({
      status: 'published',
      reviewed_by: currentUser.id,
      rejection_reason: null,
    })
    .eq('id', req.params.id)
    .eq('institution_id', currentUser.institutionId)
    .select('*')
    .maybeSingle();
  if (error) {
    console.error('Could not approve announcement:', error.code);
    return res.status(500).json({ error: 'Could not approve the announcement. Please try again.' });
  }
  if (!data) return res.status(404).json({ error: 'Announcement not found.' });
  let target: Announcement;
  try {
    [target] = await loadAnnouncementsFromSupabase(supabase, [data as AnnouncementDbRow]);
  } catch {
    return res.status(503).json({ error: 'Announcement was approved, but could not be reloaded.' });
  }

  // The database trigger persists the review notification.
  broadcastToUser(target.authorId, currentUser.institutionId, { type: 'notifications:changed' });

  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'ANNOUNCEMENT_APPROVED',
    details: `Admin approved announcement "${target.title}"`,
    timestamp: new Date().toISOString(),
  });
  await persistAuditLog(req, auditLogs[0]);

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'announcements:changed' });
  res.json({ announcement: target });
});

app.post('/api/announcements/:id/reject', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin authorization required.' });
  }

  const { reason } = req.body;
  if (reason !== undefined && typeof reason !== 'string') {
    return res.status(400).json({ error: 'Rejection reason must be text.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase
    .from('announcements')
    .update({
      status: 'archived',
      reviewed_by: currentUser.id,
      rejection_reason: reason || 'Does not meet institutional posting guidelines.',
    })
    .eq('id', req.params.id)
    .eq('institution_id', currentUser.institutionId)
    .select('*')
    .maybeSingle();
  if (error) {
    console.error('Could not reject announcement:', error.code);
    return res.status(500).json({ error: 'Could not reject the announcement. Please try again.' });
  }
  if (!data) return res.status(404).json({ error: 'Announcement not found.' });
  let target: Announcement;
  try {
    [target] = await loadAnnouncementsFromSupabase(supabase, [data as AnnouncementDbRow]);
  } catch {
    return res.status(503).json({ error: 'Announcement was rejected, but could not be reloaded.' });
  }

  // The database trigger persists the review notification.
  broadcastToUser(target.authorId, currentUser.institutionId, { type: 'notifications:changed' });

  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'ANNOUNCEMENT_REJECTED',
    details: `Admin rejected announcement "${target.title}" with reason: ${reason || 'None specified'}`,
    timestamp: new Date().toISOString(),
  });
  await persistAuditLog(req, auditLogs[0]);

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'announcements:changed' });
  res.json({ announcement: target });
});

// Delete or Archive announcement
app.delete('/api/announcements/:id', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: target, error: targetError } = await supabase
    .from('announcements')
    .select('id, author_id')
    .eq('id', req.params.id)
    .eq('institution_id', currentUser.institutionId)
    .maybeSingle();
  if (targetError) {
    console.error('Could not load announcement before deleting:', targetError.code);
    return res.status(503).json({ error: 'Could not load the announcement. Please try again later.' });
  }
  if (!target) return res.status(404).json({ error: 'Announcement not found.' });
  if (target.author_id !== currentUser.id && currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized to delete this announcement.' });
  }
  const { error } = await supabase
    .from('announcements')
    .delete()
    .eq('id', req.params.id)
    .eq('institution_id', currentUser.institutionId);
  if (error) {
    console.error('Could not delete announcement from Supabase:', error.code);
    return res.status(500).json({ error: 'Could not delete the announcement. Please try again.' });
  }

  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'ANNOUNCEMENT_DELETED',
    details: `Deleted announcement "${target.title}"`,
    timestamp: new Date().toISOString(),
  });
  await persistAuditLog(req, auditLogs[0]);

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'announcements:changed' });
  res.json({ success: true });
});

// Save / Bookmark announcement
app.post('/api/announcements/:id/save', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const annId = req.params.id;
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: existing, error: existingError } = await supabase
    .from('announcement_saves')
    .select('announcement_id')
    .eq('profile_id', currentUser.id)
    .eq('announcement_id', annId)
    .maybeSingle();
  if (existingError) {
    console.error('Could not check saved announcement state:', existingError.code);
    return res.status(503).json({ error: 'Could not update saved announcements.' });
  }
  if (existing) {
    const { error } = await supabase
      .from('announcement_saves')
      .delete()
      .eq('profile_id', currentUser.id)
      .eq('announcement_id', annId);
    if (error) {
      console.error('Could not remove saved announcement:', error.code);
      return res.status(500).json({ error: 'Could not remove the saved announcement.' });
    }
  } else {
    const { error } = await supabase.from('announcement_saves').insert({
      profile_id: currentUser.id,
      announcement_id: annId,
    });
    if (error) {
      console.error('Could not save announcement:', error.code);
      return res.status(500).json({ error: 'Could not save the announcement.' });
    }
  }
  const { data: savedRows, error: savedError } = await supabase
    .from('announcement_saves')
    .select('announcement_id')
    .eq('profile_id', currentUser.id);
  if (savedError) {
    console.error('Could not reload saved announcements:', savedError.code);
    return res.status(503).json({ error: 'The save changed, but saved announcements could not be reloaded.' });
  }
  res.json({
    isSaved: !existing,
    savedIds: (savedRows || []).map((row: { announcement_id: string }) => row.announcement_id),
  });
});

app.get('/api/saved-announcements', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: savedRows, error: savedError } = await supabase
    .from('announcement_saves')
    .select('announcement_id')
    .eq('profile_id', currentUser.id);
  if (savedError) {
    console.error('Could not load saved announcement IDs:', savedError.code);
    return res.status(503).json({ error: 'Could not load saved announcements.' });
  }
  const ids = (savedRows || []).map((row: { announcement_id: string }) => row.announcement_id);
  if (ids.length === 0) return res.json({ announcements: [], savedIds: [] });
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .in('id', ids)
    .eq('institution_id', currentUser.institutionId)
    .eq('status', 'published');
  if (error) {
    console.error('Could not load saved announcement rows:', error.code);
    return res.status(503).json({ error: 'Could not load saved announcements.' });
  }
  let saved: Announcement[];
  try {
    saved = await loadAnnouncementsFromSupabase(supabase, (data || []) as AnnouncementDbRow[]);
  } catch {
    return res.status(503).json({ error: 'Could not load saved announcement details.' });
  }
  res.json({ announcements: saved, savedIds: ids });
});

// 5. Event Registrations & Applications
app.get('/api/registrations', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: rows, error } = await supabase
    .from('event_registrations')
    .select('id, announcement_id, profile_id, registered_at, status, ticket_code')
    .eq('profile_id', currentUser.id)
    .order('registered_at', { ascending: false });
  if (error) {
    console.error('Could not load event registrations:', error.code);
    return res.status(503).json({ error: 'Could not load your registrations. Please try again later.' });
  }
  const announcementIds = [...new Set((rows || []).map((row: { announcement_id: string }) => row.announcement_id))];
  const announcementTitles = new Map<string, string>();
  if (announcementIds.length > 0) {
    const { data: announcementRows, error: announcementsError } = await supabase
      .from('announcements')
      .select('id, title')
      .in('id', announcementIds);
    if (announcementsError) {
      console.error('Could not load registered event titles:', announcementsError.code);
      return res.status(503).json({ error: 'Could not load registration details. Please try again later.' });
    }
    for (const announcement of announcementRows || []) {
      announcementTitles.set(announcement.id, announcement.title);
    }
  }
  const userRegs: EventRegistration[] = (rows || []).map((row: {
    id: string;
    announcement_id: string;
    registered_at: string;
    status: EventRegistration['status'];
    ticket_code: string | null;
  }) => ({
    id: row.id,
    announcementId: row.announcement_id,
    announcementTitle: announcementTitles.get(row.announcement_id) || 'College event',
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userEmail: currentUser.email,
    registeredAt: row.registered_at,
    status: row.status,
    ticketCode: row.ticket_code || '',
  }));
  res.json({ registrations: userRegs });
});

app.post('/api/registrations', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const { announcementId } = req.body;
  if (typeof announcementId !== 'string') {
    return res.status(400).json({ error: 'An announcement ID is required.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: ann, error: announcementError } = await supabase
    .from('announcements')
    .select('id, title')
    .eq('id', announcementId)
    .eq('institution_id', currentUser.institutionId)
    .maybeSingle();
  if (announcementError) {
    console.error('Could not load event before registration:', announcementError.code);
    return res.status(503).json({ error: 'Could not load the event. Please try again later.' });
  }
  if (!ann) return res.status(404).json({ error: 'Announcement / event not found.' });
  const { data: existing, error: existingError } = await supabase
    .from('event_registrations')
    .select('id')
    .eq('profile_id', currentUser.id)
    .eq('announcement_id', announcementId)
    .maybeSingle();
  if (existingError) {
    console.error('Could not check existing event registration:', existingError.code);
    return res.status(503).json({ error: 'Could not check your registration. Please try again.' });
  }
  if (existing) {
    return res.status(400).json({ error: 'You are already registered for this event or activity.' });
  }

  const { data: inserted, error: insertError } = await supabase
    .from('event_registrations')
    .insert({
      announcement_id: ann.id,
      profile_id: currentUser.id,
    })
    .select('id, announcement_id, registered_at, status, ticket_code')
    .single();
  if (insertError) {
    console.error('Could not save event registration:', insertError.code);
    if (insertError.code === '23505') {
      return res.status(400).json({ error: 'You are already registered for this event or activity.' });
    }
    return res.status(500).json({ error: 'Could not save your registration. Please try again.' });
  }
  const { error: notificationError } = await supabase.from('notifications').insert({
    institution_id: currentUser.institutionId,
    profile_id: currentUser.id,
    announcement_id: ann.id,
    title: 'Registration Confirmed',
    message: `You are registered for "${ann.title}". Ticket: ${inserted.ticket_code}`,
    type: 'registration',
    is_read: false,
  });
  if (notificationError) {
    const { error: rollbackError } = await supabase
      .from('event_registrations')
      .delete()
      .eq('id', inserted.id)
      .eq('profile_id', currentUser.id);
    if (rollbackError) {
      console.error('Registration rollback after notification failure failed:', rollbackError.code);
    }
    console.error('Could not save registration confirmation notification:', notificationError.code);
    return res.status(500).json({ error: 'Could not complete the registration. Please try again.' });
  }
  const newReg: EventRegistration = {
    id: inserted.id,
    announcementId: inserted.announcement_id,
    announcementTitle: ann.title,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userEmail: currentUser.email,
    registeredAt: inserted.registered_at,
    status: inserted.status,
    ticketCode: inserted.ticket_code,
  };
  broadcastToUser(currentUser.id, currentUser.institutionId, { type: 'notifications:changed' });
  broadcastToUser(currentUser.id, currentUser.institutionId, { type: 'registrations:changed' });

  res.status(201).json({ registration: newReg });
});

app.delete('/api/registrations/:id', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase
    .from('event_registrations')
    .delete()
    .eq('id', req.params.id)
    .eq('profile_id', currentUser.id)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('Could not cancel event registration:', error.code);
    return res.status(500).json({ error: 'Could not cancel your registration. Please try again.' });
  }
  if (!data) return res.status(404).json({ error: 'Registration not found.' });
  broadcastToUser(currentUser.id, currentUser.institutionId, { type: 'registrations:changed' });
  res.json({ success: true });
});

// 6. Notifications
app.get('/api/notifications', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase
    .from('notifications')
    .select('id, institution_id, profile_id, announcement_id, title, message, type, is_read, created_at')
    .eq('profile_id', currentUser.id)
    .eq('institution_id', currentUser.institutionId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Could not load notifications:', error.code);
    return res.status(503).json({ error: 'Could not load notifications. Please try again later.' });
  }
  const list: AppNotification[] = (data || []).map((row: {
    id: string;
    institution_id: string;
    profile_id: string;
    announcement_id: string | null;
    title: string;
    message: string;
    type: AppNotification['type'];
    is_read: boolean;
    created_at: string;
  }) => ({
    id: row.id,
    institutionId: row.institution_id,
    userId: row.profile_id,
    announcementId: row.announcement_id || undefined,
    title: row.title,
    message: row.message,
    type: row.type,
    isRead: row.is_read,
    createdAt: row.created_at,
  }));
  res.json({ notifications: list });
});

app.put('/api/notifications/:id/read', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', req.params.id)
    .eq('profile_id', currentUser.id)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('Could not mark notification read:', error.code);
    return res.status(500).json({ error: 'Could not update notification. Please try again.' });
  }
  if (!data) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ success: true });
});

app.put('/api/notifications/mark-all-read', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('profile_id', currentUser.id)
    .eq('institution_id', currentUser.institutionId)
    .eq('is_read', false);
  if (error) {
    console.error('Could not mark all notifications read:', error.code);
    return res.status(500).json({ error: 'Could not update notifications. Please try again.' });
  }
  res.json({ success: true });
});

// 7. Automated Summaries with Gemini API
app.post('/api/summarize', async (req: Request, res: Response) => {
  const { title, description } = req.body;
  if (!title || !description) {
    return res.status(400).json({ error: 'Title and description required for summarization.' });
  }

  // If Gemini API is available, generate concise structured summary
  if (aiClient && process.env.GEMINI_API_KEY) {
    try {
      const prompt = `Summarize this college campus notice into 4-5 high-signal bullet points prioritizing:
- What is happening
- Who it applies to (audience/department/year)
- Important dates and deadlines
- Required action or documents needed
Keep it concise, professional, and factual without adding details absent in the text.

Title: ${title}
Announcement Content:
${description}`;

      const response = await aiClient.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          systemInstruction:
            'You are the MyCollege Academic Platform intelligent notice summarizer. Generate clean bullet points starting with •. Do not output markdown headers or conversational commentary.',
        },
      });

      const summary = response.text?.trim();
      if (summary) {
        return res.json({ summary, source: 'gemini-3.8-flash' });
      }
    } catch (err) {
      console.warn('Gemini API call failed, falling back to algorithmic summarizer:', err);
    }
  }

  // Graceful fallback algorithmic summarizer
  const lines = description.split('\n').filter((l: string) => l.trim().length > 10);
  const firstSentence = lines[0] || title;
  const fallbackSummary = [
    `• What: ${title}`,
    `• Overview: ${firstSentence.slice(0, 140)}...`,
    `• Action: Review official department guidelines and attachments.`,
    `• Compliance: Follow submission timelines indicated in the announcement.`,
  ].join('\n');

  res.json({ summary: fallbackSummary, source: 'local_heuristic' });
});

// 8. Platform Statistics & Audit Logs
app.get('/api/stats', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;

  const instUsers = users.filter((u) => u.institutionId === institutionId);
  const instAnnouncements = announcements.filter((a) => a.institutionId === institutionId);
  const instRegs = registrations.filter((r) => r.institutionId === institutionId);

  const stats: PlatformStats = {
    totalUsers: instUsers.length,
    studentsCount: instUsers.filter((u) => u.role === 'student').length,
    facultyCount: instUsers.filter((u) => u.role === 'faculty').length,
    coordinatorsCount: instUsers.filter((u) => u.role === 'coordinator').length,
    activeAnnouncements: instAnnouncements.filter((a) => a.status === 'published').length,
    pendingApprovals: instAnnouncements.filter((a) => a.status === 'pending_approval').length,
    totalRegistrations: instRegs.length,
    weeklyEngagementViews: instAnnouncements.reduce((acc, curr) => acc + curr.metrics.views, 0),
  };

  res.json({ stats });
});

app.get('/api/audit-logs', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Only administrators can inspect institutional audit logs.' });
  }

  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;
  if (institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot inspect another institution’s audit logs.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, institution_id, profile_id, user_name, user_role, action, details, created_at')
    .eq('institution_id', institutionId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('Could not load audit logs from Supabase:', error.code);
    return res.status(503).json({ error: 'Could not load audit logs. Please try again later.' });
  }
  const logs: AuditLog[] = (data || []).map((row: {
    id: string;
    institution_id: string;
    profile_id: string | null;
    user_name: string;
    user_role: string;
    action: string;
    details: string;
    created_at: string;
  }) => ({
    id: row.id,
    institutionId: row.institution_id,
    userId: row.profile_id || '',
    userName: row.user_name,
    userRole: row.user_role as UserRole,
    action: row.action,
    details: row.details,
    timestamp: row.created_at,
  }));
  res.json({ auditLogs: logs });
});

// 9. Real-Time Chat Channels & Messaging API
app.get('/api/channels', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;
  if (institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot view another institution’s groups.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const type = req.query.type as string;
  const adminDb = createSupabaseAdminClient() || supabase;
  const { data: rows, error } = await adminDb
    .from('channels')
    .select('*')
    .eq('institution_id', institutionId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Could not load channels from Supabase:', error.code);
    return res.status(503).json({ error: 'Could not load groups. Please try again later.' });
  }
  const channelRows = (rows || []) as ChannelDbRow[];
  const allChannelIds = channelRows.map((channel) => channel.id);
  let memberships: ChannelMemberDbRow[] = [];
  if (allChannelIds.length > 0) {
    const { data, error: membershipsError } = await adminDb
      .from('channel_members')
      .select('channel_id, profile_id, role, status')
      .in('channel_id', allChannelIds);
    if (membershipsError) {
      console.error('Could not load channel memberships from Supabase:', membershipsError.code);
      return res.status(503).json({ error: 'Could not load group memberships. Please try again later.' });
    }
    memberships = (data || []) as ChannelMemberDbRow[];
  }
  let list = channelRows.map((row) =>
    mapChannelRow(row, memberships.filter((member) => member.channel_id === row.id))
  );
  list = list.filter((channel) => userCanAccessChannel(currentUser, channel));
  const channelIds = list.map((channel) => channel.id);
  if (channelIds.length > 0) {
    const { data: recentMessages, error: recentMessagesError } = await supabase
      .from('channel_messages')
      .select('channel_id, sender_name, content, attachment, poll_data, is_deleted, created_at')
      .in('channel_id', channelIds)
      .order('created_at', { ascending: false })
      .limit(500);
    if (recentMessagesError) {
      console.error('Could not load latest channel messages from Supabase:', recentMessagesError.code);
      return res.status(503).json({ error: 'Could not load group previews. Please try again later.' });
    }
    const latestByChannel = new Map<string, {
      sender_name: string | null;
      content: string;
      attachment: ChatMessage['attachment'] | null;
      poll_data: ChatPoll | null;
      is_deleted: boolean;
      created_at: string;
    }>();
    for (const message of recentMessages || []) {
      if (!latestByChannel.has(message.channel_id)) latestByChannel.set(message.channel_id, message);
    }
    list = list.map((channel) => {
      const recent = latestByChannel.get(channel.id);
      if (!recent) return channel;
      const text = recent.is_deleted
        ? '🚫 This message was deleted'
        : recent.poll_data
          ? `📊 Poll: ${recent.poll_data.question}`
          : recent.attachment
            ? `📎 ${recent.attachment.name}`
            : recent.content.slice(0, 80);
      return {
        ...channel,
        lastMessage: {
          senderName: recent.sender_name || 'Campus Bot',
          text,
          timestamp: recent.created_at,
        },
      };
    });
  }
  chatChannels = [
    ...chatChannels.filter((channel) => channel.institutionId !== institutionId),
    ...list,
  ];

  if (type && type !== 'all') {
    list = list.filter((c) => c.type === type);
  }
  res.json({ channels: list });
});

app.post('/api/channels', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const { name, title, description, type, pinnedAnnouncementId, departmentId, divisionId } = req.body;

  if (!name || !title) {
    return res.status(400).json({ error: 'Channel name and title are required.' });
  }
  if (
    typeof name !== 'string' ||
    typeof title !== 'string' ||
    name.trim().length > 80 ||
    title.trim().length > 80 ||
    (description !== undefined && (typeof description !== 'string' || description.length > 300)) ||
    !['class', 'club', 'interest', 'project'].includes(type)
  ) {
    return res.status(400).json({ error: 'One or more group details are invalid.' });
  }
  if (type === 'class' && currentUser.role !== 'faculty' && currentUser.role !== 'admin' && currentUser.role !== 'coordinator') {
    return res.status(403).json({ error: 'Official class channels can only be created by faculty, coordinators, or administrators.' });
  }

  const isOfficial = type === 'class' && (currentUser.role === 'faculty' || currentUser.role === 'admin');
  const cleanName = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

  const newChannel: ChatChannel = {
    id: crypto.randomUUID(),
    institutionId: currentUser.institutionId,
    name: cleanName,
    title,
    description: description || `College ${type} discussion circle`,
    type: type || 'interest',
    departmentId: typeof departmentId === 'string' ? departmentId : undefined,
    divisionId: typeof divisionId === 'string' ? divisionId : undefined,
    isOfficial,
    memberCount: 1,
    creatorId: currentUser.id,
    adminIds: [currentUser.id],
    memberIds: [currentUser.id],
    pinnedAnnouncementId: pinnedAnnouncementId || undefined,
  };

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const token = getSessionTokenFromRequest(req);
  const session = token ? activeSessions.get(token) : undefined;
  let creatorId = session?.authUserId;
  if (!creatorId) {
    const { data: authUserData } = await supabase.auth.getUser();
    creatorId = authUserData?.user?.id || currentUser.id;
  }

  let insertPayload: any = {
    id: newChannel.id,
    institution_id: newChannel.institutionId,
    department_id: typeof departmentId === 'string' ? departmentId : null,
    division_id: typeof divisionId === 'string' ? divisionId : null,
    creator_id: creatorId,
    name: newChannel.name,
    title: newChannel.title,
    description: newChannel.description,
    type: newChannel.type,
    is_official: newChannel.isOfficial,
    pinned_announcement_id: pinnedAnnouncementId || null,
    invite_code: `JOIN-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
  };

  const supabaseAdmin = createSupabaseAdminClient();
  const db = supabaseAdmin || supabase;

  let { data, error } = await db
    .from('channels')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error && (error.code === 'PGRST204' || error.message?.includes('column') || error.message?.includes('schema cache'))) {
    console.warn('[CHANNELS] Retrying channel insert without optional columns:', error.message);
    delete insertPayload.pinned_announcement_id;
    delete insertPayload.invite_code;
    const retry = await db
      .from('channels')
      .insert(insertPayload)
      .select('*')
      .single();
    data = retry.data;
    error = retry.error;
  }
  if (error || !data) {
    console.error('Could not create channel in Supabase:', error?.code, error?.message, error?.details);
    return res.status(503).json({ error: error?.message || 'Could not create the group. Please try again later.' });
  }

  try {
    const { error: memberUpsertErr } = await db
      .from('channel_members')
      .upsert({
        channel_id: data.id,
        profile_id: creatorId,
        role: 'admin',
        status: 'active',
      }, { onConflict: 'channel_id, profile_id' });
    if (memberUpsertErr) {
      console.warn('Could not record creator in channel_members:', memberUpsertErr.message);
    }
  } catch (memberErr) {
    console.warn('Could not ensure admin in channel_members:', memberErr);
  }

  const persistedChannel = mapChannelRow(data as ChannelDbRow, [{
    channel_id: data.id,
    profile_id: creatorId,
    role: 'admin',
    status: 'active',
  }]);
  chatChannels.push(persistedChannel);

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'channels:changed' });

  res.status(201).json({ channel: persistedChannel });
});

app.get('/api/channels/:id/messages', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot access another institution’s group.' });
  }

  // Enforce division authorization
  if (channel.divisionId && currentUser.role !== 'admin' && currentUser.role !== 'faculty') {
    if (!currentUser.divisionIds || !currentUser.divisionIds.includes(channel.divisionId)) {
      return res.status(403).json({ error: 'Access denied. You do not belong to this division.' });
    }
  }

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: rows, error } = await supabase
    .from('channel_messages')
    .select('*')
    .eq('channel_id', channel.id)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('Could not load channel messages from Supabase:', error.code);
    return res.status(503).json({ error: 'Could not load group messages. Please try again later.' });
  }
  const messageRows = (rows || []) as ChannelMessageDbRow[];
  const messageIds = messageRows.map((row) => row.id);
  let reactionRows: { message_id: string; profile_id: string; emoji: string | null }[] = [];
  const pollByMessage = new Map<string, ChatPoll>();
  if (messageIds.length > 0) {
    const { data: reactions, error: reactionsError } = await supabase
      .from('message_reactions')
      .select('message_id, profile_id, emoji')
      .in('message_id', messageIds);
    if (reactionsError) {
      console.error('Could not load message reactions from Supabase:', reactionsError.code);
      return res.status(503).json({ error: 'Could not load group reactions. Please try again later.' });
    }
    reactionRows = reactions || [];
    const { data: polls, error: pollsError } = await supabase
      .from('channel_polls')
      .select('id, message_id, question, multiple_answers, created_at')
      .in('message_id', messageIds);
    if (pollsError) {
      console.error('Could not load polls from Supabase:', pollsError.code);
      return res.status(503).json({ error: 'Could not load group polls. Please try again later.' });
    }
    const pollRows = (polls || []) as {
      id: string;
      message_id: string;
      question: string;
      multiple_answers: boolean;
      created_at: string;
    }[];
    if (pollRows.length > 0) {
      const pollIds = pollRows.map((poll) => poll.id);
      const { data: options, error: optionsError } = await supabase
        .from('mycollege_poll_options')
        .select('id, poll_id, option_text')
        .in('poll_id', pollIds);
      if (optionsError) {
        console.error('Could not load poll options from Supabase:', optionsError.code);
        return res.status(503).json({ error: 'Could not load group poll options. Please try again later.' });
      }
      const { data: votes, error: votesError } = await supabase
        .from('mycollege_poll_votes')
        .select('poll_id, option_id, profile_id')
        .in('poll_id', pollIds);
      if (votesError) {
        console.error('Could not load poll votes from Supabase:', votesError.code);
        return res.status(503).json({ error: 'Could not load group poll results. Please try again later.' });
      }
      const optionRows = (options || []) as { id: string; poll_id: string; option_text: string }[];
      const voteRows = (votes || []) as { poll_id: string; option_id: string | null; profile_id: string }[];
      for (const poll of pollRows) {
        pollByMessage.set(poll.message_id, {
          id: poll.id,
          question: poll.question,
          multipleAnswers: poll.multiple_answers,
          createdAt: poll.created_at,
          options: optionRows
            .filter((option) => option.poll_id === poll.id)
            .map((option) => ({
              id: option.id,
              text: option.option_text,
              votes: voteRows
                .filter((vote) => vote.poll_id === poll.id && vote.option_id === option.id)
                .map((vote) => vote.profile_id),
            })),
        });
      }
    }
  }
  const msgs = messageRows.map((row) => {
    const reactions: Record<string, string[]> = {};
    for (const reaction of reactionRows) {
      if (reaction.message_id !== row.id || !reaction.emoji) continue;
      reactions[reaction.emoji] ||= [];
      reactions[reaction.emoji].push(reaction.profile_id);
    }
    const message = mapChannelMessageRow(row, reactions);
    message.poll = pollByMessage.get(row.id) || message.poll;
    return message;
  });
  chatMessages = [
    ...chatMessages.filter((message) => message.channelId !== channel.id),
    ...msgs,
  ];
  msgs.forEach((message) => { message.institutionId = channel.institutionId; });
  res.json({ messages: msgs });
});

app.post('/api/channels/:id/messages', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot access another institution’s group.' });
  }

  // Enforce division authorization
  if (channel.divisionId && currentUser.role !== 'admin' && currentUser.role !== 'faculty') {
    if (!currentUser.divisionIds || !currentUser.divisionIds.includes(channel.divisionId)) {
      return res.status(403).json({ error: 'Access denied. You cannot send messages in another division.' });
    }
  }

  const isCircleAdmin = userCanManageChannel(currentUser, channel);

  // WhatsApp Group Permission: Only admins can send messages
  if (channel.onlyAdminsCanMessage && !isCircleAdmin) {
    return res.status(403).json({
      error: 'Only group admins can send messages to this group.',
    });
  }

  const { content, attachment, replyTo, poll } = req.body;
  if ((!content || !content.trim()) && !attachment && !poll) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }

  // Sanitize text against script injection
  const sanitizedContent = (content || '').trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const newMsg: ChatMessage = {
    id: crypto.randomUUID(),
    channelId: channel.id,
    institutionId: currentUser.institutionId,
    senderId: currentUser.id,
    senderName: currentUser.name,
    senderRole: currentUser.role,
    senderDepartment: currentUser.departmentName,
    content: sanitizedContent,
    timestamp: new Date().toISOString(),
    attachment,
    replyTo: replyTo
      ? {
          id: replyTo.id,
          senderName: replyTo.senderName,
          content: replyTo.content ? replyTo.content.slice(0, 100) : '',
          attachmentName: replyTo.attachmentName,
        }
      : undefined,
    poll,
    reactions: {},
    status: 'delivered',
  };

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const token = getSessionTokenFromRequest(req);
  const session = token ? activeSessions.get(token) : undefined;
  let senderId = session?.authUserId;
  if (!senderId) {
    const { data: authUserData } = await supabase.auth.getUser();
    senderId = authUserData?.user?.id || currentUser.id;
  }
  let msgInsertPayload: any = {
    id: newMsg.id,
    channel_id: channel.id,
    sender_id: senderId,
    content: newMsg.content,
    attachment: newMsg.attachment || null,
    reply_to_id: newMsg.replyTo?.id || null,
    reply_metadata: newMsg.replyTo || null,
    poll_data: newMsg.poll || null,
    sender_name: currentUser.name,
    sender_role: currentUser.role,
    sender_department: currentUser.departmentName || null,
    status: newMsg.status,
  };
  let { data: inserted, error } = await supabase
    .from('channel_messages')
    .insert(msgInsertPayload)
    .select('*')
    .single();

  if (error && (error.code === 'PGRST204' || error.message?.includes('column') || error.message?.includes('schema cache'))) {
    console.warn('[MESSAGES] Retrying message insert without optional metadata columns:', error.message);
    delete msgInsertPayload.reply_metadata;
    delete msgInsertPayload.poll_data;
    delete msgInsertPayload.sender_name;
    delete msgInsertPayload.sender_role;
    delete msgInsertPayload.sender_department;
    const retry = await supabase
      .from('channel_messages')
      .insert(msgInsertPayload)
      .select('*')
      .single();
    inserted = retry.data;
    error = retry.error;
  }
  if (error || !inserted) {
    console.error('Could not save channel message in Supabase:', error?.code);
    return res.status(503).json({ error: 'Could not send this message. Please try again later.' });
  }
  const savedMessage = mapChannelMessageRow(inserted as ChannelMessageDbRow);
  savedMessage.institutionId = channel.institutionId;
  chatMessages.push(savedMessage);
  const lastMessage = {
    senderName: currentUser.name,
    text: poll ? `📊 Poll: ${poll.question}` : attachment ? `📎 ${attachment.name}` : sanitizedContent.slice(0, 80),
    timestamp: savedMessage.timestamp,
  };
  channel.lastMessage = lastMessage;
  broadcastToInstitution(currentUser.institutionId, {
    type: 'message:new',
    message: savedMessage,
    channelId: channel.id,
  });

  res.status(201).json({ message: savedMessage });
});

// WhatsApp Reaction: Toggle emoji reaction on a message
app.post('/api/channels/:id/messages/:msgId/reactions', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }
  const { emoji } = req.body;
  if (typeof emoji !== 'string' || emoji.length === 0 || emoji.length > 16) {
    return res.status(400).json({ error: 'A valid emoji reaction is required.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: messageRow, error: messageError } = await supabase
    .from('channel_messages')
    .select('*')
    .eq('id', req.params.msgId)
    .eq('channel_id', channel.id)
    .maybeSingle();
  if (messageError) {
    console.error('Could not check the message before reacting:', messageError.code);
    return res.status(503).json({ error: 'Could not update the reaction. Please try again later.' });
  }
  if (!messageRow) return res.status(404).json({ error: 'Message not found.' });

  const { data: existing, error: existingError } = await supabase
    .from('message_reactions')
    .select('emoji')
    .eq('message_id', req.params.msgId)
    .eq('profile_id', currentUser.id)
    .eq('emoji', emoji)
    .maybeSingle();
  if (existingError) {
    console.error('Could not check existing message reaction:', existingError.code);
    return res.status(503).json({ error: 'Could not update the reaction. Please try again later.' });
  }
  if (existing) {
    const { error } = await supabase
      .from('message_reactions')
      .delete()
      .eq('message_id', req.params.msgId)
      .eq('profile_id', currentUser.id)
      .eq('emoji', emoji);
    if (error) {
      console.error('Could not remove message reaction:', error.code);
      return res.status(503).json({ error: 'Could not remove the reaction. Please try again later.' });
    }
  } else {
    const { error } = await supabase.from('message_reactions').insert({
      message_id: req.params.msgId,
      profile_id: currentUser.id,
      emoji,
    });
    if (error) {
      console.error('Could not save message reaction:', error.code);
      return res.status(503).json({ error: 'Could not save the reaction. Please try again later.' });
    }
  }
  const { data: reactionRows, error: reactionsError } = await supabase
    .from('message_reactions')
    .select('profile_id, emoji')
    .eq('message_id', req.params.msgId);
  if (reactionsError) {
    console.error('Could not reload message reactions:', reactionsError.code);
    return res.status(503).json({ error: 'The reaction changed, but reactions could not be reloaded.' });
  }
  const reactions: Record<string, string[]> = {};
  for (const reaction of reactionRows || []) {
    if (typeof reaction.emoji !== 'string') continue;
    reactions[reaction.emoji] ||= [];
    reactions[reaction.emoji].push(reaction.profile_id);
  }
  const msg = mapChannelMessageRow(messageRow as ChannelMessageDbRow, reactions);
  msg.institutionId = channel.institutionId;
  const cachedMessageIndex = chatMessages.findIndex((message) => message.id === msg.id);
  if (cachedMessageIndex >= 0) chatMessages[cachedMessageIndex] = msg;
  else chatMessages.push(msg);

  broadcastToInstitution(currentUser.institutionId, {
    type: 'message:reaction',
    channelId: req.params.id,
    messageId: msg.id,
    reactions: msg.reactions,
  });

  res.json({ success: true, message: msg });
});

// WhatsApp Pin/Unpin Message in Group
app.post('/api/channels/:id/messages/:msgId/pin', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }
  const { isPinned } = req.body;
  const isCircleAdmin = userCanManageChannel(currentUser, channel);
  if (!isCircleAdmin) {
    return res.status(403).json({ error: 'Only group administrators can pin messages.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const pinned = Boolean(isPinned);
  const { data: row, error: messageError } = await supabase
    .from('channel_messages')
    .update({ is_pinned: pinned })
    .eq('id', req.params.msgId)
    .eq('channel_id', channel.id)
    .select('*')
    .maybeSingle();
  if (messageError) {
    console.error('Could not update pinned message in Supabase:', messageError.code);
    return res.status(503).json({ error: 'Could not update the pinned message. Please try again later.' });
  }
  if (!row) return res.status(404).json({ error: 'Message not found.' });
  const pinnedMessageId = pinned ? row.id : channel.pinnedMessageId === row.id ? null : channel.pinnedMessageId;
  const { data: channelRow, error: channelError } = await supabase
    .from('channels')
    .update({ pinned_message_id: pinnedMessageId })
    .eq('id', channel.id)
    .select('*')
    .single();
  if (channelError) {
    console.error('Could not update pinned channel metadata in Supabase:', channelError.code);
    return res.status(503).json({ error: 'The message pin changed, but the group could not be updated.' });
  }
  const msg = mapChannelMessageRow(row as ChannelMessageDbRow);
  msg.institutionId = channel.institutionId;
  channel.pinnedMessageId = pinnedMessageId || undefined;
  const channelIndex = chatChannels.findIndex((candidate) => candidate.id === channel.id);
  if (channelIndex >= 0) {
    const cachedChannel = chatChannels[channelIndex];
    cachedChannel.pinnedMessageId = channelRow.pinned_message_id || undefined;
  }

  broadcastToInstitution(currentUser.institutionId, {
    type: 'message:pinned',
    channelId: channel.id,
    messageId: msg.id,
    isPinned: msg.isPinned,
  });

  res.json({ success: true, message: msg, channel });
});

// WhatsApp Delete Message (For everyone or sender)
app.delete('/api/channels/:id/messages/:msgId', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: existingRow, error: existingError } = await supabase
    .from('channel_messages')
    .select('*')
    .eq('id', req.params.msgId)
    .eq('channel_id', channel.id)
    .maybeSingle();
  if (existingError) {
    console.error('Could not load message before deletion:', existingError.code);
    return res.status(503).json({ error: 'Could not delete the message. Please try again later.' });
  }
  if (!existingRow) return res.status(404).json({ error: 'Message not found.' });
  const isCircleAdmin = userCanManageChannel(currentUser, channel);

  if (existingRow.sender_id !== currentUser.id && !isCircleAdmin) {
    return res.status(403).json({ error: 'You can only delete your own messages or be a group admin.' });
  }
  const { data: row, error } = await supabase
    .from('channel_messages')
    .update({ is_deleted: true, attachment: null, poll_data: null })
    .eq('id', req.params.msgId)
    .eq('channel_id', channel.id)
    .select('*')
    .single();
  if (error) {
    console.error('Could not delete message in Supabase:', error.code);
    return res.status(503).json({ error: 'Could not delete the message. Please try again later.' });
  }
  const msg = mapChannelMessageRow(row as ChannelMessageDbRow);
  msg.institutionId = channel.institutionId;
  const messageIndex = chatMessages.findIndex((candidate) => candidate.id === msg.id);
  if (messageIndex >= 0) chatMessages[messageIndex] = msg;

  broadcastToInstitution(currentUser.institutionId, {
    type: 'message:deleted',
    channelId: channel.id,
    messageId: msg.id,
  });

  res.json({ success: true, message: msg });
});

// WhatsApp Poll Creation & Voting
app.post('/api/channels/:id/polls', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin = userCanManageChannel(currentUser, channel);

  if (channel.onlyAdminsCanMessage && !isCircleAdmin) {
    return res.status(403).json({ error: 'Only group admins can post polls in this group.' });
  }

  const { question, options, multipleAnswers } = req.body;
  if (
    typeof question !== 'string' ||
    !question.trim() ||
    question.length > 300 ||
    !Array.isArray(options) ||
    options.length < 2 ||
    options.some((option: unknown) => typeof option !== 'string' || !option.trim() || option.length > 160)
  ) {
    return res.status(400).json({ error: 'Poll requires a question and at least 2 options.' });
  }

  const poll: ChatPoll = {
    id: crypto.randomUUID(),
    question: question.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    options: options.map((opt: string, idx: number) => ({
      id: crypto.randomUUID(),
      text: opt.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      votes: [],
    })),
    multipleAnswers: Boolean(multipleAnswers),
    createdAt: new Date().toISOString(),
  };

  const newMsg: ChatMessage = {
    id: crypto.randomUUID(),
    channelId: channel.id,
    institutionId: currentUser.institutionId,
    senderId: currentUser.id,
    senderName: currentUser.name,
    senderRole: currentUser.role,
    senderDepartment: currentUser.departmentName,
    content: `📊 Poll: ${poll.question}`,
    timestamp: new Date().toISOString(),
    poll,
    status: 'delivered',
  };

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: savedMessageRow, error: messageError } = await supabase
    .from('channel_messages')
    .insert({
      id: newMsg.id,
      channel_id: channel.id,
      sender_id: currentUser.id,
      content: newMsg.content,
      sender_name: currentUser.name,
      sender_role: currentUser.role,
      sender_department: currentUser.departmentName || null,
      poll_data: poll,
      status: newMsg.status,
    })
    .select('*')
    .single();
  if (messageError || !savedMessageRow) {
    console.error('Could not save poll message in Supabase:', messageError?.code);
    return res.status(503).json({ error: 'Could not create the poll. Please try again later.' });
  }
  const { error: pollError } = await supabase.from('channel_polls').insert({
    id: poll.id,
    channel_id: channel.id,
    message_id: newMsg.id,
    question: poll.question,
    multiple_answers: Boolean(multipleAnswers),
    created_by: currentUser.id,
  });
  if (pollError) {
    console.error('Could not save poll record in Supabase:', pollError.code);
    return res.status(503).json({ error: 'The poll message was saved, but its poll record could not be created.' });
  }
  const { error: optionsError } = await supabase.from('mycollege_poll_options').insert(
    poll.options.map((option, index) => ({
      id: option.id,
      poll_id: poll.id,
      option_text: option.text,
      position: index,
    }))
  );
  if (optionsError) {
    console.error('Could not save poll options in Supabase:', optionsError.code);
    return res.status(503).json({ error: 'The poll was created, but its options could not be saved.' });
  }
  const savedMessage = mapChannelMessageRow(savedMessageRow as ChannelMessageDbRow);
  savedMessage.institutionId = channel.institutionId;
  chatMessages.push(savedMessage);
  channel.lastMessage = {
    senderName: currentUser.name,
    text: `📊 Poll: ${poll.question.slice(0, 60)}`,
    timestamp: savedMessage.timestamp,
  };

  broadcastToInstitution(currentUser.institutionId, {
    type: 'message:new',
    message: savedMessage,
    channelId: channel.id,
  });

  res.status(201).json({ message: savedMessage });
});

// Vote on a WhatsApp Group Poll
app.post('/api/channels/:id/messages/:msgId/vote', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }
  const { optionId } = req.body;
  if (typeof optionId !== 'string') {
    return res.status(400).json({ error: 'A poll option is required.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: pollRow, error: pollError } = await supabase
    .from('channel_polls')
    .select('id, question, multiple_answers')
    .eq('message_id', req.params.msgId)
    .eq('channel_id', channel.id)
    .maybeSingle();
  if (pollError) {
    console.error('Could not load poll in Supabase:', pollError.code);
    return res.status(503).json({ error: 'Could not load this poll. Please try again later.' });
  }
  if (!pollRow) return res.status(404).json({ error: 'Poll message not found.' });
  const { data: optionRows, error: optionsError } = await supabase
    .from('mycollege_poll_options')
    .select('id, option_text')
    .eq('poll_id', pollRow.id);
  if (optionsError) {
    console.error('Could not load poll options from Supabase:', optionsError.code);
    return res.status(503).json({ error: 'Could not load poll options. Please try again later.' });
  }
  const typedOptionRows = (optionRows || []) as { id: string; option_text: string }[];
  const validOption = typedOptionRows.some((option) => option.id === optionId);
  if (!validOption) return res.status(404).json({ error: 'Poll option not found.' });
  const { data: voteRows, error: votesError } = await supabase
    .from('mycollege_poll_votes')
    .select('option_id, profile_id')
    .eq('poll_id', pollRow.id)
    .eq('profile_id', currentUser.id);
  if (votesError) {
    console.error('Could not load existing poll votes:', votesError.code);
    return res.status(503).json({ error: 'Could not update your vote. Please try again later.' });
  }
  const typedVoteRows = (voteRows || []) as { option_id: string | null; profile_id: string }[];
  const hasVotedThis = typedVoteRows.some((vote) => vote.option_id === optionId);
  if (!pollRow.multiple_answers || hasVotedThis) {
    const { error: deleteError } = await supabase
      .from('mycollege_poll_votes')
      .delete()
      .eq('poll_id', pollRow.id)
      .eq('profile_id', currentUser.id);
    if (deleteError) {
      console.error('Could not update poll vote selection:', deleteError.code);
      return res.status(503).json({ error: 'Could not update your vote. Please try again later.' });
    }
  }
  if (!hasVotedThis) {
    const { error: insertError } = await supabase.from('mycollege_poll_votes').insert({
      poll_id: pollRow.id,
      option_id: optionId,
      profile_id: currentUser.id,
    });
    if (insertError) {
      console.error('Could not save poll vote:', insertError.code);
      return res.status(503).json({ error: 'Could not save your vote. Please try again later.' });
    }
  }

  const { data: allVotes, error: allVotesError } = await supabase
    .from('mycollege_poll_votes')
    .select('option_id, profile_id')
    .eq('poll_id', pollRow.id);
  if (allVotesError) {
    console.error('Could not reload poll votes:', allVotesError.code);
    return res.status(503).json({ error: 'Your vote was saved, but poll results could not be reloaded.' });
  }
  const typedAllVotes = (allVotes || []) as { option_id: string | null; profile_id: string }[];
  const poll: ChatPoll = {
    id: pollRow.id,
    question: pollRow.question,
    multipleAnswers: pollRow.multiple_answers,
    createdAt: new Date().toISOString(),
    options: typedOptionRows.map((option) => ({
      id: option.id,
      text: option.option_text,
      votes: typedAllVotes
        .filter((vote) => vote.option_id === option.id)
        .map((vote) => vote.profile_id),
    })),
  };
  const { data: msgRow, error: messageError } = await supabase
    .from('channel_messages')
    .select('*')
    .eq('id', req.params.msgId)
    .eq('channel_id', channel.id)
    .maybeSingle();
  if (messageError) {
    console.error('Could not reload poll message:', messageError.code);
    return res.status(503).json({ error: 'Your vote was saved, but the poll message could not be reloaded.' });
  }
  if (!msgRow) return res.status(404).json({ error: 'Poll message not found.' });
  const msg = mapChannelMessageRow(msgRow as ChannelMessageDbRow);
  msg.institutionId = channel.institutionId;
  msg.poll = poll;
  const messageIndex = chatMessages.findIndex((message) => message.id === msg.id);
  if (messageIndex >= 0) chatMessages[messageIndex] = msg;
  else chatMessages.push(msg);
  broadcastToInstitution(currentUser.institutionId, {
    type: 'poll:updated',
    channelId: req.params.id,
    messageId: msg.id,
    poll,
  });

  res.json({ success: true, poll, message: msg });
});

// 10. Channel Members & Admin Management (Make Admin, Dismiss Admin, Permissions)
app.get('/api/channels/:id/members', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot view another institution’s group.' });
  }

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const db = createSupabaseAdminClient() || supabase;

  // 1. Fetch all memberships directly from Supabase DB to ensure nothing is missed
  const { data: dbMemberships } = await db
    .from('channel_members')
    .select('profile_id, role, status')
    .eq('channel_id', channel.id)
    .eq('status', 'active');

  const memberIdSet = new Set<string>();
  if (channel.creatorId) memberIdSet.add(channel.creatorId);
  (channel.memberIds || []).forEach((id) => memberIdSet.add(id));
  (channel.adminIds || []).forEach((id) => memberIdSet.add(id));
  (dbMemberships || []).forEach((m: any) => memberIdSet.add(m.profile_id));

  // If this is a class channel, also include enrolled division students
  if (channel.type === 'class' && channel.divisionId) {
    users.filter((u) => u.divisionIds?.includes(channel.divisionId!)).forEach((u) => memberIdSet.add(u.id));
  }

  const memberIds = Array.from(memberIdSet);
  const { data: profiles, error } = memberIds.length > 0
    ? await db
        .from('profiles')
        .select('id, institution_id, full_name, email, role, department_id, username, designation, course, year, roll_no, phone, avatar_url, is_verified, is_profile_completed')
        .in('id', memberIds)
    : { data: [], error: null };
  if (error) {
    console.error('Could not load channel member profiles:', error.code);
  }
  const profileRows = (profiles || []) as {
    id: string;
    institution_id: string;
    full_name: string | null;
    email: string;
    role: string;
    department_id: string | null;
    username: string | null;
    designation: string | null;
    course: string | null;
    year: string | null;
    roll_no: string | null;
    phone: string | null;
    avatar_url: string | null;
    is_verified: boolean;
    is_profile_completed: boolean;
  }[];
  const members: User[] = profileRows.map((profile) => {
    const cachedUser = users.find((user) => user.id === profile.id || user.email.toLowerCase() === profile.email.toLowerCase());
    if (cachedUser) return { ...cachedUser, id: profile.id, role: (profile.role || cachedUser.role) as UserRole, designation: profile.designation || cachedUser.designation };
    return {
      id: profile.id,
      institutionId: profile.institution_id,
      name: profile.full_name || profile.email,
      email: profile.email,
      role: profile.role as UserRole,
      departmentId: profile.department_id || '',
      departmentName: departments.find((department) => department.id === profile.department_id)?.name,
      username: profile.username || undefined,
      designation: profile.designation || undefined,
      course: profile.course || undefined,
      year: profile.year || undefined,
      rollNo: profile.roll_no || undefined,
      phone: profile.phone || undefined,
      avatar: profile.avatar_url || undefined,
      interests: [],
      notificationPreferences: { academic: true, events: true, deadlines: true, clubs: true },
      isVerified: profile.is_verified,
      isProfileCompleted: profile.is_profile_completed,
    };
  });

  // Guarantee every member in memberIds is in members list even if profile sync was delayed
  const foundMemberIds = new Set(members.map((m) => m.id));
  for (const mId of memberIds) {
    if (!foundMemberIds.has(mId)) {
      const fallbackUser = users.find((u) => u.id === mId);
      if (fallbackUser) {
        members.push(fallbackUser);
        foundMemberIds.add(fallbackUser.id);
      }
    }
  }

  // Derive all admin IDs: channel creator + explicit admins + database admins
  const adminIdSet = new Set<string>(channel.adminIds || []);
  if (channel.creatorId) adminIdSet.add(channel.creatorId);
  (dbMemberships || []).forEach((m: any) => {
    if (m.role === 'admin' || m.role === 'owner') adminIdSet.add(m.profile_id);
  });
  members.forEach((m) => {
    if (m.role === 'admin') adminIdSet.add(m.id);
  });

  res.json({
    members,
    creatorId: channel.creatorId,
    adminIds: Array.from(adminIdSet),
    onlyAdminsCanMessage: channel.onlyAdminsCanMessage || false,
    onlyAdminsCanEditInfo: channel.onlyAdminsCanEditInfo || false,
    inviteCode: channel.inviteCode || `JOIN-${channel.id}`,
    inviteLink: `${req.protocol}://${req.get('host')}/circle/join/${channel.id}?code=${channel.inviteCode || 'INVITE'}`,
  });
});

app.get('/api/channels/:id/member-candidates', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (!userCanAddChannelMembers(currentUser, channel)) {
    return res.status(403).json({ error: 'Only faculty or group administrators can add members.' });
  }

  const candidateMap = new Map<string, {
    id: string | null;
    name: string;
    email: string;
    role: 'student' | 'faculty';
    designation?: string;
    rollNo?: string;
    membershipStatus: 'not_added' | 'active' | 'pending';
  }>();

  const supabase = await getSupabaseClientForRequest(req);
  if (supabase) {
    const { data, error } = await supabase.rpc('mycollege_list_channel_member_candidates', {
      p_channel_id: channel.id,
    });
    if (!error && Array.isArray(data)) {
      for (const item of data as Array<any>) {
        const email = (item.email || '').toLowerCase().trim();
        if (!email) continue;
        candidateMap.set(email, {
          id: item.id || null,
          name:
            item.name ||
            item.full_name ||
            item.fullName ||
            (email ? email.split('@')[0].replace(/[._]/g, ' ') : 'Member'),
          email,
          role: item.role === 'teacher' ? 'faculty' : (item.role || 'student'),
          designation: item.designation || undefined,
          rollNo: item.roll_no || item.rollNo || undefined,
          membershipStatus: item.membership_status || item.membershipStatus || 'not_added',
        });
      }
    } else {
      console.warn('RPC mycollege_list_channel_member_candidates returned code:', error?.code);
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, full_name, email, role, designation')
        .eq('institution_id', currentUser.institutionId);
      if (Array.isArray(profileRows)) {
        for (const p of profileRows) {
          const email = (p.email || '').toLowerCase().trim();
          if (!email) continue;
          candidateMap.set(email, {
            id: p.id,
            name: p.full_name || (email ? email.split('@')[0].replace(/[._]/g, ' ') : 'Member'),
            email,
            role: p.role === 'teacher' ? 'faculty' : (p.role || 'student'),
            designation: p.designation || undefined,
            rollNo: undefined,
            membershipStatus: (channel.memberIds || []).includes(p.id) ? 'active' : 'not_added',
          });
        }
      }
    }
  }

  // Also include in-memory institutional users so search is never empty
  for (const u of users) {
    const email = (u.email || '').toLowerCase().trim();
    if (!email || candidateMap.has(email)) continue;
    if (u.institutionId === currentUser.institutionId) {
      candidateMap.set(email, {
        id: u.id,
        name: u.name,
        email,
        role: u.role === 'student' ? 'student' : 'faculty',
        designation: u.designation,
        rollNo: u.rollNo,
        membershipStatus: (channel.memberIds || []).includes(u.id) ? 'active' : 'not_added',
      });
    }
  }

  const candidates = Array.from(candidateMap.values());
  res.json({ candidates });
});

// Make someone Group Admin (WhatsApp Group Admin feature)
app.post('/api/channels/:id/admins', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin = userCanManageChannel(currentUser, channel);

  if (!isCircleAdmin) {
    return res.status(403).json({ error: 'Only group admins can appoint new admins.' });
  }

  const { userId } = req.body;
  if (typeof userId !== 'string') return res.status(400).json({ error: 'userId is required.' });
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: targetProfile, error: profileError } = await adminDb
    .from('profiles')
    .select('id, institution_id, full_name, email, role, department_id, username, designation, course, year, phone, avatar_url, is_verified, is_profile_completed')
    .eq('id', userId)
    .eq('institution_id', currentUser.institutionId)
    .maybeSingle();
  if (profileError) {
    console.error('Could not load group admin profile:', profileError.code);
    return res.status(503).json({ error: 'Could not load the selected user. Please try again later.' });
  }
  if (!targetProfile) return res.status(404).json({ error: 'User not found.' });
  const targetUser: User = users.find((user) => user.id === userId) || {
    id: targetProfile.id,
    institutionId: targetProfile.institution_id,
    name: targetProfile.full_name || targetProfile.email,
    email: targetProfile.email,
    role: targetProfile.role as UserRole,
    departmentId: targetProfile.department_id || '',
    username: targetProfile.username || undefined,
    designation: targetProfile.designation || undefined,
    course: targetProfile.course || undefined,
    year: targetProfile.year || undefined,
    phone: targetProfile.phone || undefined,
    avatar: targetProfile.avatar_url || undefined,
    interests: [],
    notificationPreferences: { academic: true, events: true, deadlines: true, clubs: true },
    isVerified: targetProfile.is_verified,
    isProfileCompleted: targetProfile.is_profile_completed,
  };
  const supabaseAdmin = createSupabaseAdminClient();
  const db = supabaseAdmin || supabase;
  const { error: membershipError } = await db
    .from('channel_members')
    .upsert(
      { channel_id: channel.id, profile_id: userId, role: 'admin', status: 'active' },
      { onConflict: 'channel_id,profile_id' }
    );
  if (membershipError) {
    console.error('Could not appoint channel admin in Supabase:', membershipError.code);
    return res.status(503).json({ error: 'Could not update group administrators. Please try again later.' });
  }
  channel.adminIds ||= [];
  channel.memberIds ||= [];
  if (!channel.adminIds.includes(userId)) channel.adminIds.push(userId);
  if (!channel.memberIds.includes(userId)) channel.memberIds.push(userId);
  channel.memberCount = channel.memberIds.length;
  const sysMsg = await persistChannelSystemMessage(
    supabase,
    channel,
    currentUser,
    'Group Security',
    `🛡️ ${targetUser.name} was appointed as Group Admin by ${currentUser.name}.`
  );
  if (!sysMsg) {
    return res.status(503).json({ error: 'The admin role was saved, but its group message could not be saved.' });
  }

  broadcastToInstitution(currentUser.institutionId, {
    type: 'admin:added',
    channelId: channel.id,
    userId: targetUser.id,
    adminIds: channel.adminIds,
    message: sysMsg,
  });

  res.json({ success: true, adminIds: channel.adminIds, user: targetUser });
});

// Dismiss as Group Admin (WhatsApp Group Admin feature)
app.delete('/api/channels/:id/admins/:userId', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin = userCanManageChannel(currentUser, channel);

  if (!isCircleAdmin) {
    return res.status(403).json({ error: 'Only group admins can dismiss other admins.' });
  }

  const targetUserId = req.params.userId;
  if (targetUserId === channel.creatorId) {
    return res.status(400).json({ error: 'The group creator cannot be dismissed as an administrator.' });
  }
  const targetUser = users.find((u) => u.id === targetUserId);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: updatedMember, error: membershipError } = await supabase
    .from('channel_members')
    .update({ role: 'member' })
    .eq('channel_id', channel.id)
    .eq('profile_id', targetUserId)
    .eq('status', 'active')
    .select('profile_id')
    .maybeSingle();
  if (membershipError) {
    console.error('Could not remove channel admin in Supabase:', membershipError.code);
    return res.status(503).json({ error: 'Could not update group administrators. Please try again later.' });
  }
  if (!updatedMember) return res.status(404).json({ error: 'Group administrator not found.' });
  channel.adminIds = (channel.adminIds || []).filter((id) => id !== targetUserId);
  const sysMsg = await persistChannelSystemMessage(
    supabase,
    channel,
    currentUser,
    'Group Security',
    `ℹ️ ${targetUser ? targetUser.name : 'Participant'} is no longer a Group Admin.`
  );
  if (!sysMsg) {
    return res.status(503).json({ error: 'The admin role was removed, but its group message could not be saved.' });
  }

  broadcastToInstitution(currentUser.institutionId, {
    type: 'admin:removed',
    channelId: channel.id,
    userId: targetUserId,
    adminIds: channel.adminIds || [],
    message: sysMsg,
  });

  res.json({ success: true, adminIds: channel.adminIds || [] });
});

// Update WhatsApp Group Settings & Permissions (Who can message, Who can edit info)
app.put('/api/channels/:id/settings', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin = userCanManageChannel(currentUser, channel);

  if (!isCircleAdmin) {
    return res.status(403).json({ error: 'Only group admins can edit this group settings.' });
  }

  const { title, description, onlyAdminsCanMessage, onlyAdminsCanEditInfo, groupIcon } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 80) {
      return res.status(400).json({ error: 'Group title must be between 1 and 80 characters.' });
    }
    updates.title = title.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  if (description !== undefined) {
    if (typeof description !== 'string' || description.length > 300) {
      return res.status(400).json({ error: 'Group description must be 300 characters or fewer.' });
    }
    updates.description = description.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  if (groupIcon !== undefined) {
    if (typeof groupIcon !== 'string' || groupIcon.length > 2048) {
      return res.status(400).json({ error: 'Group icon value is invalid.' });
    }
    updates.group_icon = groupIcon;
  }
  if (onlyAdminsCanMessage !== undefined) {
    if (typeof onlyAdminsCanMessage !== 'boolean') {
      return res.status(400).json({ error: 'Message permission must be a boolean.' });
    }
    updates.only_admins_can_message = onlyAdminsCanMessage;
  }
  if (onlyAdminsCanEditInfo !== undefined) {
    if (typeof onlyAdminsCanEditInfo !== 'boolean') {
      return res.status(400).json({ error: 'Group info permission must be a boolean.' });
    }
    updates.only_admins_can_edit_info = onlyAdminsCanEditInfo;
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: updatedRow, error } = await supabase
    .from('channels')
    .update(updates)
    .eq('id', channel.id)
    .select('*')
    .single();
  if (error) {
    console.error('Could not update channel settings in Supabase:', error.code);
    return res.status(503).json({ error: 'Could not save group settings. Please try again later.' });
  }
  channel.title = updatedRow.title;
  channel.description = updatedRow.description;
  channel.groupIcon = updatedRow.group_icon || undefined;
  channel.onlyAdminsCanMessage = updatedRow.only_admins_can_message;
  channel.onlyAdminsCanEditInfo = updatedRow.only_admins_can_edit_info;

  broadcastToInstitution(currentUser.institutionId, {
    type: 'channel:updated',
    channel,
  });

  res.json({ success: true, channel });
});

// Delete Channel / Group (Allowed only for group admin and app admin)
app.delete('/api/channels/:id', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot delete another institution’s group.' });
  }

  const isCircleAdmin = userCanManageChannel(currentUser, channel);
  if (!isCircleAdmin) {
    return res.status(403).json({ error: 'Only group administrators or application administrators can delete this group.' });
  }

  const db = createSupabaseAdminClient() || (await getSupabaseClientForRequest(req));
  if (db) {
    try {
      await db.from('channel_messages').delete().eq('channel_id', channel.id);
      await db.from('channel_members').delete().eq('channel_id', channel.id);
      await db.from('channel_announcements').delete().eq('channel_id', channel.id);
      const { error: delErr } = await db.from('channels').delete().eq('id', channel.id);
      if (delErr) {
        console.error('Could not delete group from Supabase:', delErr.code);
        return res.status(503).json({ error: 'Could not delete group. Please try again later.' });
      }
    } catch (e: any) {
      console.error('Error during group deletion:', e);
      return res.status(503).json({ error: 'Failed to delete group.' });
    }
  }

  const idx = chatChannels.findIndex((c) => c.id === channel.id);
  if (idx >= 0) chatChannels.splice(idx, 1);

  broadcastToInstitution(currentUser.institutionId, {
    type: 'channel:deleted',
    channelId: channel.id,
  });

  res.json({ success: true, channelId: channel.id });
});

// Reset Invite Code
app.post('/api/channels/:id/reset-invite', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin = userCanManageChannel(currentUser, channel);

  if (!isCircleAdmin) {
    return res.status(403).json({ error: 'Only group admins can reset the invite link.' });
  }

  const inviteCode = `JOIN-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { error } = await supabase
    .from('channels')
    .update({ invite_code: inviteCode })
    .eq('id', channel.id);
  if (error) {
    console.error('Could not reset channel invite in Supabase:', error.code);
    return res.status(503).json({ error: 'Could not reset the invite link. Please try again later.' });
  }
  channel.inviteCode = inviteCode;

  res.json({
    success: true,
    inviteCode: channel.inviteCode,
    inviteLink: `${req.protocol}://${req.get('host')}/circle/join/${channel.id}?code=${channel.inviteCode}`,
  });
});

app.post('/api/channels/:id/members', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  if (!userCanAddChannelMembers(currentUser, channel)) {
    return res.status(403).json({ error: 'Only faculty or group administrators can add members.' });
  }

  const { userId, email } = req.body;
  if (typeof email !== 'string' && typeof userId !== 'string') {
    return res.status(400).json({ error: 'A member email or userId is required.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  let memberEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!memberEmail && typeof userId === 'string') {
    const { data: target, error: targetError } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .eq('institution_id', currentUser.institutionId)
      .maybeSingle();
    if (targetError) {
      console.error('Could not load selected group member:', targetError.code);
      return res.status(503).json({ error: 'Could not load the selected user. Please try again later.' });
    }
    if (!target) return res.status(404).json({ error: 'Student or faculty member not found.' });
    memberEmail = target.email;
  }
  const adminDb = createSupabaseAdminClient() || supabase;
  let addResult: any = null;
  const { data: rpcRes, error: addError } = await adminDb.rpc('mycollege_add_channel_member', {
    p_channel_id: channel.id,
    p_email: memberEmail,
  });
  if (!addError && rpcRes) {
    addResult = rpcRes;
  } else {
    // Direct fallback via adminDb
    const { data: directProfile } = await adminDb
      .from('profiles')
      .select('id')
      .eq('institution_id', currentUser.institutionId)
      .ilike('email', memberEmail)
      .maybeSingle();
    if (directProfile) {
      await adminDb
        .from('channel_members')
        .upsert({
          channel_id: channel.id,
          profile_id: directProfile.id,
          role: 'member',
          status: 'active',
        }, { onConflict: 'channel_id, profile_id' });
      addResult = { status: 'active', profile_id: directProfile.id };
    } else {
      console.error('Could not add channel member in Supabase:', addError?.code);
      if (addError?.code === '42501') {
        return res.status(403).json({ error: 'You do not have permission to add this person.' });
      }
      if (addError?.code === 'P0002') {
        return res.status(404).json({ error: 'This person is not in the authorized student or faculty directory.' });
      }
      return res.status(503).json({ error: 'Could not add this member. Apply the latest Circle roster migration and try again.' });
    }
  }

  const result = addResult as { status: 'active' | 'pending'; profile_id?: string };
  if (result.status === 'pending') {
    return res.json({ success: true, pending: true, memberCount: channel.memberCount });
  }
  if (!result.profile_id) {
    console.error('Adding a channel member returned an active status without a profile ID.');
    return res.status(503).json({ error: 'Could not confirm the new group member. Please try again.' });
  }
  const { data: targetProfile, error: profileError } = await adminDb
    .from('profiles')
    .select('id, institution_id, full_name, email, role, department_id, is_verified, is_profile_completed')
    .eq('id', result.profile_id)
    .eq('institution_id', currentUser.institutionId)
    .maybeSingle();
  if (profileError || !targetProfile) {
    console.error('Could not load added group member profile:', profileError?.code);
    return res.status(503).json({ error: 'The member was added, but their profile could not be loaded.' });
  }
  const targetUser: User = users.find((user) => user.id === targetProfile.id) || {
    id: targetProfile.id,
    institutionId: targetProfile.institution_id,
    name: targetProfile.full_name || targetProfile.email,
    email: targetProfile.email,
    role: targetProfile.role as UserRole,
    departmentId: targetProfile.department_id || '',
    interests: [],
    notificationPreferences: { academic: true, events: true, deadlines: true, clubs: true },
    isVerified: targetProfile.is_verified,
    isProfileCompleted: targetProfile.is_profile_completed,
  };
  channel.memberIds ||= [];
  if (!channel.memberIds.includes(targetUser.id)) {
    channel.memberIds.push(targetUser.id);
    channel.memberCount = channel.memberIds.length;
  }
  const sysMsg = await persistChannelSystemMessage(
    supabase,
    channel,
    currentUser,
    'Group System',
    `${currentUser.name} added ${targetUser.name} to the group.`
  );
  if (!sysMsg) {
    return res.status(503).json({ error: 'The member was added, but the group notice could not be saved.' });
  }

  // Send notification to the student
  notifications.unshift({
    id: `notif-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: targetUser.id,
    title: `Added to Circle #${channel.name}`,
    message: `${currentUser.name} added you to "${channel.title}". Join the academic discussion now.`,
    type: 'announcement',
    isRead: false,
    createdAt: new Date().toISOString(),
  });
  broadcastToUser(targetUser.id, currentUser.institutionId, { type: 'notifications:changed' });

  broadcastToInstitution(currentUser.institutionId, {
    type: 'member:added',
    channelId: channel.id,
    user: targetUser,
    memberCount: channel.memberCount,
    message: sysMsg,
  });

  res.json({ success: true, member: targetUser, memberCount: channel.memberCount, pending: false, message: sysMsg });
});

app.delete('/api/channels/:id/members/:userId', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin = userCanManageChannel(currentUser, channel);

  const isRemovingSelf = req.params.userId === currentUser.id;

  if (!isCircleAdmin && !isRemovingSelf) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const targetUser = users.find((u) => u.id === req.params.userId);
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const sysMsg = await persistChannelSystemMessage(
    supabase,
    channel,
    currentUser,
    'Campus Bot',
    isRemovingSelf
      ? `${currentUser.name} left the group.`
      : `${targetUser ? targetUser.name : 'Participant'} was removed by ${currentUser.name}.`
  );
  if (!sysMsg) {
    return res.status(503).json({ error: 'Could not save the group notice; the member was not removed.' });
  }
  const { data: removedMember, error: removalError } = await supabase
    .from('channel_members')
    .delete()
    .eq('channel_id', channel.id)
    .eq('profile_id', req.params.userId)
    .select('profile_id')
    .maybeSingle();
  if (removalError) {
    console.error('Could not remove channel member in Supabase:', removalError.code);
    return res.status(503).json({ error: 'Could not remove this group member. Please try again later.' });
  }
  if (!removedMember && !isRemovingSelf) return res.status(404).json({ error: 'Group member not found.' });
  channel.memberIds = (channel.memberIds || []).filter((id) => id !== req.params.userId);
  channel.memberCount = channel.memberIds.length;
  channel.adminIds = (channel.adminIds || []).filter((id) => id !== req.params.userId);

  broadcastToInstitution(currentUser.institutionId, {
    type: 'member:removed',
    channelId: channel.id,
    userId: req.params.userId,
    memberCount: channel.memberCount,
    message: sysMsg,
  });
  broadcastToUser(req.params.userId, currentUser.institutionId, {
    type: 'member:removed',
    channelId: channel.id,
    userId: req.params.userId,
    memberCount: channel.memberCount,
  });

  res.json({ success: true, memberCount: channel.memberCount });
});

app.post('/api/channels/:id/join', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot join another institution’s group.' });
  }

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data: existingMembership, error: existingError } = await supabase
    .from('channel_members')
    .select('profile_id')
    .eq('channel_id', channel.id)
    .eq('profile_id', currentUser.id)
    .maybeSingle();
  if (existingError) {
    console.error('Could not check channel join state:', existingError.code);
    return res.status(503).json({ error: 'Could not join this group. Please try again later.' });
  }
  if (!existingMembership) {
    const supabaseAdmin = createSupabaseAdminClient();
    const db = supabaseAdmin || supabase;
    const { error: joinError } = await db.from('channel_members').insert({
      channel_id: channel.id,
      profile_id: currentUser.id,
      role: 'member',
      status: 'active',
    });
    if (joinError) {
      console.error('Could not join channel in Supabase:', joinError.code);
      return res.status(503).json({ error: 'Could not join this group. Please try again later.' });
    }
    channel.memberIds ||= [];
    channel.memberIds.push(currentUser.id);
    channel.memberCount = channel.memberIds.length;
    const joinMsg = await persistChannelSystemMessage(
      supabase,
      channel,
      currentUser,
      'Campus Bot',
      `${currentUser.name} joined #${channel.name} via invite link.`
    );
    if (!joinMsg) {
      return res.status(503).json({ error: 'You joined the group, but the welcome notice could not be saved.' });
    }

    broadcastToInstitution(currentUser.institutionId, {
      type: 'member:added',
      channelId: channel.id,
      user: currentUser,
      memberCount: channel.memberCount,
      message: joinMsg,
    });
  }

  res.json({ success: true, channel });
});

// 11. Circle Announcements (Separate Column & Feed Integration)
app.get('/api/channels/:id/announcements', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot view another institution’s group announcements.' });
  }

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const adminDb = createSupabaseAdminClient() || supabase;
  const { data, error } = await adminDb
    .from('channel_announcements')
    .select('*')
    .eq('channel_id', channel.id)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Could not load circle announcements from Supabase:', error.code);
    return res.status(503).json({ error: 'Could not load group announcements. Please try again later.' });
  }
  const list: CircleAnnouncement[] = (data || []).map((row: {
    id: string;
    channel_id: string;
    announcement_id: string | null;
    author_id: string | null;
    author_name: string | null;
    author_role: string | null;
    title: string;
    content: string;
    priority: string;
    deadline: string | null;
    attachment: CircleAnnouncement['attachment'] | null;
    created_at: string;
  }) => ({
    id: row.id,
    channelId: row.channel_id,
    announcementId: row.announcement_id || undefined,
    institutionId: channel.institutionId,
    title: row.title,
    content: row.content,
    authorId: row.author_id || '',
    authorName: row.author_name || 'College staff',
    authorRole: (row.author_role || 'faculty') as UserRole,
    timestamp: row.created_at,
    priority: row.priority as PriorityLevel,
    deadline: row.deadline || undefined,
    attachment: row.attachment || undefined,
  }));
  circleAnnouncements = [
    ...circleAnnouncements.filter((announcement) => announcement.channelId !== channel.id),
    ...list,
  ];
  res.json({ announcements: list });
});

app.post('/api/channels/:id/announcements', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = await loadChannelForRequest(req, res, req.params.id);
  if (!channel) return;
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot post in another institution’s group.' });
  }

  const isCircleAdmin = userCanManageChannel(currentUser, channel);

  if (!isCircleAdmin) {
    return res.status(403).json({
      error: 'Only circle administrators, faculty, or coordinators can broadcast official announcements in this circle.',
    });
  }

  const { title, content, priority, deadline, attachment } = req.body;
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 200 ||
    typeof content !== 'string' ||
    !content.trim() ||
    content.length > 10000 ||
    (priority !== undefined && !['urgent', 'high', 'normal', 'low'].includes(priority)) ||
    (deadline !== undefined && (typeof deadline !== 'string' || Number.isNaN(Date.parse(deadline))))
  ) {
    return res.status(400).json({ error: 'Title and content are required for circle announcements.' });
  }
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const now = new Date().toISOString();
  const announcementId = crypto.randomUUID();
  const circleAnnouncementId = crypto.randomUUID();
  const institution = institutions.find((item) => item.id === currentUser.institutionId);
  const isStaff = ['admin', 'faculty', 'teacher'].includes(currentUser.role);
  const requiresApproval = Boolean(institution?.requireApproval && !isStaff);
  const token = getSessionTokenFromRequest(req);
  const session = token ? activeSessions.get(token) : undefined;
  let authorId = session?.authUserId;
  if (!authorId) {
    const { data: authUserData } = await supabase.auth.getUser();
    authorId = authUserData?.user?.id || currentUser.id;
  }
  const cleanTitle = title.trim();
  const cleanContent = content.trim();
  const announcementRow = {
    id: announcementId,
    institution_id: currentUser.institutionId,
    author_id: authorId,
    title: `[${channel.title}] ${cleanTitle}`,
    description: cleanContent,
    category: channel.type === 'class' ? 'academics' : channel.type === 'club' ? 'clubs' : 'general',
    publishing_department: channel.title,
    audience_type: 'all',
    audience_data: {},
    priority: priority || 'normal',
    status: requiresApproval ? 'pending_approval' : 'published',
    publication_date: now,
    registration_deadline: deadline || null,
    is_pinned: priority === 'urgent',
    is_official: currentUser.role === 'faculty' || currentUser.role === 'admin',
    author_name: currentUser.name,
    author_role: currentUser.role,
  };
  const adminDb = createSupabaseAdminClient() || supabase;
  const { data: savedAnnouncement, error: announcementError } = await adminDb
    .from('announcements')
    .insert(announcementRow)
    .select('*')
    .single();
  if (announcementError || !savedAnnouncement) {
    console.error('Could not save circle announcement to the campus feed:', announcementError?.code, announcementError?.message);
    return res.status(503).json({ error: 'Could not save the circle announcement. Please try again later.' });
  }
  try {
    const { error: notificationError } = await adminDb.rpc(
      'mycollege_notify_announcement',
      { target_announcement_id: announcementId }
    );
    if (notificationError) {
      console.warn('Circle announcement notifications warning (non-fatal):', notificationError.code || notificationError.message);
    }
  } catch (notifErr) {
    console.warn('Could not run circle announcement notifications:', notifErr);
  }
  const { data: savedCircleRow, error: circleError } = await adminDb
    .from('channel_announcements')
    .insert({
      id: circleAnnouncementId,
      channel_id: channel.id,
      announcement_id: announcementId,
      author_id: authorId,
      author_name: currentUser.name,
      author_role: currentUser.role,
      title: cleanTitle,
      content: cleanContent,
      priority: priority || 'normal',
      deadline: deadline || null,
      attachment: attachment || null,
    })
    .select('*')
    .single();
  if (circleError || !savedCircleRow) {
    console.error('Campus announcement saved but circle announcement failed:', circleError?.code);
    return res.status(503).json({ error: 'The campus announcement was saved, but its group post could not be created.' });
  }
  const newCircleAnn: CircleAnnouncement = {
    id: savedCircleRow.id,
    channelId: channel.id,
    institutionId: currentUser.institutionId,
    announcementId,
    title: cleanTitle,
    content: cleanContent,
    authorId: currentUser.id,
    authorName: currentUser.name,
    authorRole: currentUser.role,
    timestamp: savedCircleRow.created_at,
    priority: priority || 'normal',
    deadline,
    attachment,
  };
  circleAnnouncements.unshift(newCircleAnn);
  let campusAnn: Announcement;
  try {
    [campusAnn] = await loadAnnouncementsFromSupabase(supabase, [savedAnnouncement as AnnouncementDbRow]);
  } catch {
    return res.status(503).json({ error: 'The announcement was saved, but its campus feed details could not be loaded.' });
  }
  const broadcastChatMsg = await persistChannelSystemMessage(
    supabase,
    channel,
    currentUser,
    currentUser.name,
    `📢 OFFICIAL CIRCLE ANNOUNCEMENT:\n\n**${cleanTitle}**\n\n${cleanContent}`
  );
  if (!broadcastChatMsg) {
    return res.status(503).json({ error: 'The announcement was saved, but its group message could not be posted.' });
  }
  const { error: pinError } = await supabase
    .from('channel_messages')
    .update({ is_pinned: true })
    .eq('id', broadcastChatMsg.id)
    .eq('channel_id', channel.id);
  if (pinError) {
    console.error('Announcement message saved but could not be pinned:', pinError.code);
    return res.status(503).json({ error: 'The announcement was posted, but its group message could not be pinned.' });
  }
  broadcastChatMsg.isPinned = true;

  broadcastToInstitution(currentUser.institutionId, {
    type: 'announcement:new',
    channelId: channel.id,
    announcement: newCircleAnn,
    message: broadcastChatMsg,
  });
  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'announcements:changed' });

  res.status(201).json({ circleAnnouncement: newCircleAnn, campusAnnouncement: campusAnn });
});

// 12. Student Batch Directory Summary
app.get('/api/batch-directory', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;
  if (institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot view another institution’s batch summary.' });
  }
  const departmentId = req.query.departmentId as string | undefined;
  const division = req.query.division as string;
  const year = req.query.year as string;
  const divisionIds: Record<string, string> = {
    'Div A': DIVISION_IDS.a,
    'Div B': DIVISION_IDS.b,
  };
  if (division && division !== 'all' && !divisionIds[division]) {
    return res.status(400).json({ error: 'Select a valid division.' });
  }
  if (departmentId && departmentId !== 'all' && !/^[0-9a-f-]{36}$/i.test(departmentId)) {
    return res.status(400).json({ error: 'Select a valid department.' });
  }

  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { data, error } = await supabase.rpc('mycollege_count_batch_students', {
    p_institution_id: institutionId,
    p_department_id: !departmentId || departmentId === 'all' ? null : departmentId,
    p_division_id: !division || division === 'all' ? null : divisionIds[division],
    p_academic_year: !year || year === 'all' ? null : year,
  });
  if (error || data === null) {
    console.error('Could not load persisted batch directory summary:', error?.code);
    return res.status(503).json({
      error: 'Could not load the batch summary. Apply the latest batch-directory migration and try again.',
    });
  }

  res.json({ total: Number(data) });
});

app.post('/api/batch-directory/students', async (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'faculty' && currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Only faculty or administrators can add students to a batch.' });
  }

  const { name, email, rollNo, departmentId, year, division, phone } = req.body as {
    name?: string;
    email?: string;
    rollNo?: string;
    departmentId?: string;
    year?: string;
    division?: string;
    phone?: string;
  };
  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = typeof email === 'string' ? normalizeEmail(email) : '';
  const cleanRollNo = typeof rollNo === 'string' ? rollNo.trim() : '';
  const cleanYear = typeof year === 'string' ? year.trim() : '';
  const cleanDivision = typeof division === 'string' ? division.trim() : '';
  const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

  if (!cleanName || !cleanEmail || !cleanRollNo || !departmentId || !cleanYear || !cleanDivision) {
    return res.status(400).json({ error: 'Name, email, roll number, department, year, and division are required.' });
  }
  if (cleanName.length < 2 || cleanName.length > 100 || cleanRollNo.length > 40 || cleanYear.length > 40) {
    return res.status(400).json({ error: 'One or more student fields are invalid.' });
  }
  if (cleanPhone && (!/^\+?[0-9\s().-]{7,20}$/.test(cleanPhone) || (cleanPhone.match(/\d/g) || []).length < 7)) {
    return res.status(400).json({ error: 'Please provide a valid student phone number.' });
  }
  if (!isValidEmailFormat(cleanEmail)) {
    return res.status(400).json({ error: 'Please provide a valid student email address.' });
  }

  const institution = institutions.find((item) => item.id === currentUser.institutionId);
  const emailDomain = cleanEmail.split('@')[1];
  if (!institution || !institution.allowedDomains.some((domain) => domain.toLowerCase() === emailDomain)) {
    return res.status(400).json({ error: 'Student email must use an authorized institutional email domain.' });
  }
  const department = departments.find(
    (item) => item.id === departmentId && item.institutionId === currentUser.institutionId
  );
  if (!department) {
    return res.status(400).json({ error: 'Select a valid department.' });
  }
  if (cleanDivision !== 'Div A' && cleanDivision !== 'Div B') {
    return res.status(400).json({ error: 'Select a valid division.' });
  }

  const divisionId = cleanDivision === 'Div A' ? DIVISION_IDS.a : DIVISION_IDS.b;
  const supabase = await getSupabaseClientForRequest(req);
  if (!supabase) {
    return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  }
  const { error: addStudentError } = await supabase.rpc('mycollege_add_batch_student', {
    p_name: cleanName,
    p_email: cleanEmail,
    p_roll_no: cleanRollNo,
    p_department_id: department.id,
    p_year: cleanYear,
    p_division_id: divisionId,
    p_phone: cleanPhone || null,
  });
  if (addStudentError) {
    if (addStudentError.code === '23505') {
      return res.status(409).json({
        error: addStudentError.message.includes('roll number')
          ? 'A student with this roll number already exists.'
          : addStudentError.message.includes('profile already exists')
            ? 'A user with this email address already exists.'
            : 'This email is already registered or authorized.',
      });
    }
    if (addStudentError.code === '42501') {
      return res.status(403).json({ error: 'Only faculty or administrators can add students to a batch.' });
    }
    if (addStudentError.code === '22023') {
      return res.status(400).json({ error: 'The selected department or division is invalid.' });
    }
    console.error('Could not persist the new batch student:', addStudentError.code);
    return res.status(503).json({
      error: 'Could not save this student to the database. Apply the latest batch-directory migration and try again.',
    });
  }

  const now = new Date().toISOString();
  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'BATCH_STUDENT_ADDED',
    details: `Added a student account to ${department.name}, ${cleanDivision}, ${cleanYear}.`,
    timestamp: now,
  });
  await persistAuditLog(req, auditLogs[0]);

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'directory:changed' });
  res.status(201).json({ message: 'Student added to the batch successfully.' });
});


// ----------------------------------------------------
// VITE DEV SERVER & WEBSOCKET INTEGRATION
// ----------------------------------------------------

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 1024 });

const clientSockets = new Map<WebSocket, string>();

function canUserViewAnnouncement(user: User, announcement: Announcement): boolean {
  if (user.role === 'admin' || announcement.authorId === user.id) return true;
  return announcementTargetsUser(user, announcement);
}

function announcementTargetsUser(user: User, announcement: Announcement): boolean {
  const audience = announcement.targetAudience;
  switch (audience.type) {
    case 'department':
      return Boolean(audience.departmentIds?.includes(user.departmentId));
    case 'course':
      return Boolean(user.course && audience.courses?.includes(user.course));
    case 'year':
      return Boolean(user.year && audience.years?.includes(user.year));
    default:
      return true;
  }
}

wss.on('connection', (ws, req) => {
  void (async () => {
    if (!hasSameOrigin(req)) {
      ws.close(1008, 'Origin not allowed');
      return;
    }

    const token = getSessionTokenFromRequest(req);
    if (!token) {
      ws.close(1008, 'Authentication required');
      return;
    }

    let session = activeSessions.get(token);
    try {
      if (!session) {
        session = (await loadSessionRecord(token)) || undefined;
        if (session) {
          activeSessions.set(token, session);
          if (!users.some((candidate) => candidate.id === session?.userId)) {
            users.push(session.userSnapshot);
          }
        }
      }
    } catch (restoreError) {
      console.error('Could not restore the WebSocket session:', restoreError);
      ws.close(1011, 'Session validation unavailable');
      return;
    }

    const user = session && Date.now() < session.expiresAt
      ? users.find((candidate) => candidate.id === session.userId)
      : undefined;
    if (!session || !user) {
      ws.close(1008, 'Authentication required');
      return;
    }
    if (ws.readyState !== WebSocket.OPEN) return;

    clientSockets.set(ws, token);
    ws.send(JSON.stringify({ type: 'auth:ok' }));

    ws.on('message', (raw) => {
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
      const message = data as { type?: unknown };
      const token = clientSockets.get(ws);
      const session = token ? activeSessions.get(token) : undefined;
      if (!session || Date.now() >= session.expiresAt) {
        clientSockets.delete(ws);
        ws.close(1008, 'Session expired');
        return;
      }

      if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    });

    ws.on('close', () => {
      clientSockets.delete(ws);
    });
  })();
});

function broadcastToInstitution(institutionId: string, payload: {
  channelId?: string;
  channel?: ChatChannel;
  [key: string]: unknown;
}) {
  const channelId = payload.channelId || payload.channel?.id;
  const channel = (channelId ? chatChannels.find((item) => item.id === channelId) : undefined) || payload.channel;
  if (!channel || channel.institutionId !== institutionId) return;

  const broadcastPayload = payload.user && typeof payload.user === 'object'
    ? { ...payload, user: { ...payload.user, phone: undefined } }
    : payload;
  const msg = JSON.stringify(broadcastPayload);
  for (const [socket, token] of clientSockets) {
    const session = activeSessions.get(token);
    const user = session && Date.now() < session.expiresAt
      ? users.find((candidate) => candidate.id === session.userId)
      : undefined;

    if (!user || user.institutionId !== institutionId) {
      clientSockets.delete(socket);
      socket.close(1008, 'Session expired');
      continue;
    }

    const hasChannelAccess = userCanAccessChannel(user, channel);

    if (hasChannelAccess && socket.readyState === WebSocket.OPEN) {
      socket.send(msg);
    }
  }
}

async function startServer() {
  const distDir = path.resolve(__dirname, 'dist');
  const indexHtml = path.resolve(distDir, 'index.html');

  if (fs.existsSync(indexHtml)) {
    console.log(`Serving static production build from ${distDir}`);
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found.' });
      }
      res.sendFile(indexHtml);
    });
  } else {
    console.log('Serving with Vite middleware (development or missing dist fallback)...');
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      try {
        const templatePath = path.resolve(__dirname, 'index.html');
        let template = fs.readFileSync(templatePath, 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
  }

  // Global Express uncaught error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled server error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  server.listen(PORT, () => {
    serverReady = true;
    console.log(`MyCollege Server & WebSockets running on port ${PORT}`);

    // ── Self-ping keep-alive ─────────────────────────────────────────────────
    // Render free tier spins down after ~15 min of inactivity.
    // Pinging our own /api/health every 8 minutes keeps the dyno warm.
    if (process.env.NODE_ENV === 'production') {
      const keepAliveUrl = process.env.APP_URL
        ? `${process.env.APP_URL}/api/health`
        : 'https://mycollege-app.onrender.com/api/health';

      const ping = () => {
        import('https')
          .then(({ default: https }) => {
            const req = https.get(keepAliveUrl, (res) => {
              res.resume(); // drain response body to free socket
            });
            req.on('error', () => {}); // silently ignore errors
            req.setTimeout(10000, () => req.destroy());
          })
          .catch(() => {});
      };

      // First ping after 5 min (let server fully warm up), then every 8 min
      setTimeout(ping, 5 * 60 * 1000);
      setInterval(ping, 8 * 60 * 1000);
      console.log('[KEEPALIVE] Self-ping enabled every 8 min to prevent Render cold starts.');
    }
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
