import express, { Request, Response } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { GoogleGenAI } from '@google/genai';
import {
  buildApprovedDataset,
  normalizeEmail,
  isValidEmailFormat,
  DIVISIONS,
  type ApprovedStudent,
  type Division,
} from './src/server/approvedStudentsData.ts';
import { FACULTY_DETAILS } from './src/server/facultyData.ts';
import type {
  Announcement,
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
  User,
  UserRole,
} from './src/types/index.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '10mb' }));

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
const { studentsMap: approvedStudentsMap, report: initialApprovedDatasetReport } = buildApprovedDataset();
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

// Nodemailer transport setup
let mailTransporter: any = null;
const isSmtpConfigured = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
);

if (isSmtpConfigured) {
  try {
    mailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    console.log('✅ SMTP Mailer initialized for live email OTP delivery to @somaiya.edu inboxes.');
  } catch (err) {
    console.warn('⚠️ SMTP mailer initialization notice:', err);
  }
} else {
  console.log('ℹ️ SMTP is not configured in .env. Server will run with cryptographic OTP generation, expiry check, single-use enforcement, and preview delivery.');
}

export interface StoredOtp {
  email: string;
  code: string;
  expiresAt: number;
  attempts: number;
  isUsed: boolean;
  createdAt: number;
  lastRequestedAt: number;
  requestCountInWindow: number;
  windowStart: number;
}

const otpStore = new Map<string, StoredOtp>();

export interface SessionRecord {
  token: string;
  userId: string;
  email: string;
  createdAt: number;
  expiresAt: number;
}

const activeSessions = new Map<string, SessionRecord>();

// Pre-register user-student-1 (Prathmesh Dhore) in approved roster
const prathmeshRec = approvedStudentsMap.get('prathmesh.dhore@somaiya.edu');
if (prathmeshRec) {
  prathmeshRec.isRegistered = true;
  prathmeshRec.registeredUserId = 'user-student-1';
  prathmeshRec.registeredName = 'Prathmesh Dhore';
  prathmeshRec.registeredUsername = 'prathmesh_dhore';
}

// ----------------------------------------------------
// MULTI-TENANT IN-MEMORY / PERSISTED STATE
// ----------------------------------------------------

const institutions: Institution[] = [
  {
    id: 'somaiya',
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
    id: 'dept-comp',
    institutionId: 'somaiya',
    name: 'Computer Engineering',
    code: 'COMP',
    courses: ['B.Tech Computer Science', 'M.Tech AI & Data Science'],
  },
  {
    id: 'dept-it',
    institutionId: 'somaiya',
    name: 'Information Technology',
    code: 'IT',
    courses: ['B.Tech Information Technology', 'M.Tech Cyber Security'],
  },
  {
    id: 'dept-extc',
    institutionId: 'somaiya',
    name: 'Electronics & Telecommunication',
    code: 'EXTC',
    courses: ['B.Tech Electronics & Telecom'],
  },
  {
    id: 'dept-mech',
    institutionId: 'somaiya',
    name: 'Mechanical Engineering',
    code: 'MECH',
    courses: ['B.Tech Mechanical Engineering', 'M.Tech Robotics'],
  },
  {
    id: 'dept-aids',
    institutionId: 'somaiya',
    name: 'Artificial Intelligence & Data Science',
    code: 'AIDS',
    courses: ['B.Tech Artificial Intelligence & Data Science'],
  },
];

const users: User[] = [
  {
    id: 'user-student-1',
    institutionId: 'somaiya',
    name: 'Prathmesh Dhore',
    email: 'prathmesh.dhore@somaiya.edu',
    username: 'prathmesh_dhore',
    phone: '+91 98201 44512',
    rollNo: 'AIDS-25-01',
    role: 'student',
    departmentId: 'dept-aids',
    departmentName: 'Artificial Intelligence & Data Science',
    course: 'B.Tech Artificial Intelligence & Data Science',
    year: 'Second Year',
    division: 'SY-A-DIVISION AI-DS 2026–27',
    divisionIds: ['sy-aids-a'],
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
    institutionId: 'somaiya',
    name: faculty.name,
    email: normalizeEmail(faculty.email),
    username: `faculty_${index + 1}`,
    role: 'faculty',
    departmentId: 'dept-aids',
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
    institutionId: 'somaiya',
    name: 'Priya Nair',
    email: 'priya.nair@somaiya.edu',
    username: 'priya_nair',
    phone: '+91 98210 55621',
    rollNo: 'IT-24-018',
    role: 'coordinator',
    departmentId: 'dept-it',
    departmentName: 'Information Technology',
    course: 'B.Tech Information Technology',
    year: '3rd Year',
    division: 'Div A',
    divisionIds: ['sy-aids-a', 'sy-aids-b'],
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
    institutionId: 'somaiya',
    name: 'Dean S. K. Kulkarni',
    email: 'dean.academic@somaiya.edu',
    username: 'dean_kulkarni',
    phone: '+91 98200 12345',
    rollNo: 'ADMIN-01',
    role: 'admin',
    departmentId: 'dept-comp',
    departmentName: 'Dean of Academic Affairs',
    divisionIds: ['sy-aids-a', 'sy-aids-b'],
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
        institutionId: 'somaiya',
        name: item.name,
        email,
        phone: `+91 ${item.phone}`,
        rollNo: `AIDS-24-${item.roll}`,
        role: 'student',
        departmentId: 'dept-aids',
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

// Helper to extract session token from Authorization or x-session-token header
function getSessionTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const xSession = req.headers['x-session-token'];
  if (typeof xSession === 'string' && xSession.trim()) {
    return xSession.trim();
  }
  return null;
}

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

// Standard helper with safe fallback for existing endpoints
function getCurrentUser(req: Request): User {
  const authed = getStrictAuthenticatedUser(req);
  if (authed) return authed;
  return users.find((u) => u.id === 'user-student-1') || users[0];
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
app.use('/api', (req: Request, res: Response, next) => {
  const publicPaths = new Set([
    '/auth/request-otp',
    '/auth/verify-otp',
    '/auth/session',
    '/divisions',
  ]);
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

  // Faculty access is limited to the email addresses in the official faculty roster.
  const approved = approvedStudentsMap.get(norm);
  const isFacultyLogin = facultyDetailsByEmail.has(norm);
  if ((!approved || approved.status === 'revoked') && !isFacultyLogin) {
    return res.status(403).json({
      error: 'This email is not authorized to access the college application. Please contact the administrator if you believe this is an error.',
    });
  }

  // 2. Strict Rate Limiting (Abuse prevention)
  const now = Date.now();
  let existing = otpStore.get(norm);

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

  // Development-only OTP preview must be explicitly enabled; never expose OTPs in production.
  const devPreviewEnabled = process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_OTP_PREVIEW === 'true';
  if (!mailTransporter && !devPreviewEnabled) {
    return res.status(503).json({ error: 'Email verification is temporarily unavailable. Please try again later or contact the administrator.' });
  }

  // 3. Cryptographically Secure 6-Digit OTP Generation
  const code = crypto.randomInt(100000, 1000000).toString();
  const expiresAt = now + 5 * 60 * 1000; // 5-minute expiry

  otpStore.set(norm, {
    email: norm,
    code,
    expiresAt,
    attempts: 0,
    isUsed: false,
    createdAt: now,
    lastRequestedAt: now,
    requestCountInWindow: (existing?.requestCountInWindow || 0) + 1,
    windowStart: existing?.windowStart || now,
  });

  // 4. Real Email Dispatch via Nodemailer if configured
  let sentViaSmtp = false;
  if (mailTransporter) {
    try {
      await mailTransporter.sendMail({
        from: `"MyCollege Security" <${process.env.SMTP_USER || 'no-reply@somaiya.edu'}>`,
        to: norm,
        subject: `Your MyCollege Verification Code: ${code}`,
        text: `Your single-use verification code for your MyCollege account is: ${code}. It expires in 5 minutes. Do not share this code with anyone.`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 20px;">
              <div style="display: inline-block; width: 44px; height: 44px; background-color: #2563eb; color: #ffffff; border-radius: 12px; font-weight: bold; font-size: 20px; line-height: 44px;">M</div>
              <h2 style="color: #0f172a; margin: 12px 0 4px 0; font-size: 20px;">MyCollege — SY AI-DS 2026–27</h2>
              <p style="color: #64748b; font-size: 13px; margin: 0;">Authorized Student Verification</p>
            </div>
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 20px;">
              <p style="color: #475569; font-size: 13px; margin: 0 0 10px 0;">Your single-use verification code is:</p>
              <div style="font-size: 34px; font-weight: 800; letter-spacing: 6px; color: #2563eb; font-family: monospace;">${code}</div>
              <p style="color: #94a3b8; font-size: 11px; margin: 10px 0 0 0;">⏱️ Valid for 5 minutes · Single-use only</p>
            </div>
            <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin: 0;">This email was sent to ${norm} for MyCollege account verification. If you did not request this code, you can safely ignore this message.</p>
          </div>
        `,
      });
      sentViaSmtp = true;
      console.log(`[AUTH] Sent genuine email OTP to ${norm} via SMTP.`);
    } catch (sendErr) {
      console.warn(`[AUTH] Failed to send email via SMTP to ${norm}:`, sendErr);
    }
  }

  if (!sentViaSmtp && !devPreviewEnabled) {
    otpStore.delete(norm);
    return res.status(503).json({ error: 'We could not deliver the verification email. Please try again later.' });
  }

  // Never log OTP values. In local development, preview is opt-in and disabled in production.
  console.log(`[AUTH] Verification code ${sentViaSmtp ? 'sent' : 'generated for local development'} for an approved account; expires in 5 minutes.`);

  const deliveryNote = sentViaSmtp
    ? `A verification code was sent to ${norm}. Please check your college inbox.`
    : 'Development preview is enabled. Use the local test code shown below; never enable this in production.';

  res.json({
    success: true,
    email: norm,
    expiresInSeconds: 300,
    isSmtpConfigured: sentViaSmtp,
    previewCode: !sentViaSmtp && devPreviewEnabled ? code : undefined,
    deliveryNote,
  });
});

// 2. Verify One-Time Code & Authenticate Session
app.post('/api/auth/verify-otp', (req: Request, res: Response) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and verification code are required.' });
  }

  const norm = normalizeEmail(email);
  const cleanCode = String(code).trim();

  // Validate OTP in store
  const stored = otpStore.get(norm);
  if (!stored) {
    return res.status(400).json({ error: 'No active verification code found for this email. Please request a new code.' });
  }

  if (stored.isUsed) {
    return res.status(400).json({ error: 'This verification code has already been used. Please request a new code.' });
  }

  if (Date.now() > stored.expiresAt) {
    return res.status(400).json({ error: 'Verification code has expired. Codes are only valid for 5 minutes.' });
  }

  if (stored.attempts >= 5) {
    return res.status(400).json({
      error: 'Too many incorrect attempts. For your security, this code has been invalidated. Please request a new code.',
    });
  }

  if (stored.code !== cleanCode) {
    stored.attempts += 1;
    const remaining = 5 - stored.attempts;
    return res.status(400).json({
      error: `Invalid verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
    });
  }

  // Mark single-use
  stored.isUsed = true;

  // Ensure authorized
  const approved = approvedStudentsMap.get(norm);
  const facultyDetails = facultyDetailsByEmail.get(norm);
  const isFacultyLogin = Boolean(facultyDetails);
  if ((!approved || approved.status === 'revoked') && !isFacultyLogin) {
    return res.status(403).json({ error: 'Access revoked or unauthorized.' });
  }

  // Find or create the provisioned faculty account or an approved student account.
  let user = users.find((u) => normalizeEmail(u.email) === norm);
  let isFirstTime = false;

  const divisionIds = isFacultyLogin ? [] : approved?.divisionIds || [];
  const divisionLabels = divisionIds.map((dId) => {
    const d = DIVISIONS.find((div) => div.id === dId);
    return d ? d.name : dId;
  });

  if (!user) {
    isFirstTime = !isFacultyLogin;
    const namePart = norm.split('@')[0];
    const autoName = facultyDetails?.name || namePart
      .split('.')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join(' ');

    user = {
      id: `user-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      institutionId: 'somaiya',
      name: autoName,
      email: norm,
      username: isFacultyLogin
        ? `faculty_${FACULTY_DETAILS.findIndex((faculty) => normalizeEmail(faculty.email) === norm) + 1}`
        : '',
      role: isFacultyLogin ? 'faculty' : 'student',
      departmentId: 'dept-aids',
      departmentName: 'Artificial Intelligence & Data Science',
      ...(facultyDetails ? { designation: facultyDetails.designation } : {}),
      ...(isFacultyLogin
        ? {}
        : {
            course: 'B.Tech Artificial Intelligence & Data Science',
            year: 'Second Year',
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
      isVerified: true,
      isProfileCompleted: isFacultyLogin,
    };
    users.push(user);
  } else {
    user.isVerified = true;
    if (facultyDetails) {
      user.name = facultyDetails.name;
      user.designation = facultyDetails.designation;
      user.role = 'faculty';
      user.institutionId = 'somaiya';
      user.departmentId ||= 'dept-aids';
      user.departmentName ||= 'Artificial Intelligence & Data Science';
    } else if (approved) {
      user.divisionIds = [...divisionIds];
      user.divisionNames = divisionLabels;
      user.division = divisionLabels.join(' & ');
    }
    isFirstTime = !isFacultyLogin && !user.isProfileCompleted;
  }

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

  // Generate genuine session token
  const token = `mct_${crypto.randomUUID()}_${Date.now()}`;
  activeSessions.set(token, {
    token,
    userId: user.id,
    email: user.email,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days session
  });

  // Audit log
  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: 'somaiya',
    userId: user.id,
    userName: user.name,
    userRole: user.role,
    action: isFacultyLogin ? 'FACULTY_SIGNED_IN' : 'STUDENT_SIGNED_IN',
    details: `${user.role} ${user.email} authenticated via single-use OTP.`,
    timestamp: new Date().toISOString(),
  });

  const matchingDivisions = DIVISIONS.filter((d) => divisionIds.includes(d.id));

  res.json({
    token,
    user,
    isFirstTime,
    divisions: matchingDivisions,
  });
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

app.post('/api/auth/accept-terms', (req: Request, res: Response) => {
  const currentUser = requireAuth(req, res);
  if (!currentUser) return;

  currentUser.termsAcceptedAt = new Date().toISOString();
  res.json({ user: currentUser, message: 'Terms and conditions accepted.' });
});

// 4. Complete First-Time Student Profile
app.post('/api/auth/complete-profile', (req: Request, res: Response) => {
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

  // Check username collision
  const collision = users.find(
    (u) => u.username && u.username.toLowerCase() === cleanUsername && u.id !== currentUser.id
  );
  if (collision) {
    return res.status(400).json({ error: 'This username is already taken. Please pick another one.' });
  }

  // Save profile
  currentUser.name = facultyDetails?.name || name.trim();
  if (facultyDetails) currentUser.designation = facultyDetails.designation;
  currentUser.username = cleanUsername;
  currentUser.isProfileCompleted = true;
  if (avatar) currentUser.avatar = avatar;

  if (Array.isArray(interests) && interests.length > 0) {
    currentUser.interests = interests;
  }

  // Update the approved student roster when this account has a student record.
  const approved = approvedStudentsMap.get(normalizeEmail(currentUser.email));
  if (approved) {
    approved.isRegistered = true;
    approved.registeredUserId = currentUser.id;
    approved.registeredName = currentUser.name;
    approved.registeredUsername = currentUser.username;
    approved.updatedAt = new Date().toISOString();
  }

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

  res.json({ user: currentUser, message: 'Profile saved successfully!' });
});

// 5. Sign Out / Invalidate Session
app.post('/api/auth/logout', (req: Request, res: Response) => {
  const token = getSessionTokenFromRequest(req);
  if (token) {
    activeSessions.delete(token);
  }
  res.json({ success: true, message: 'Signed out successfully.' });
});

// 6. Get Current Auth Session
app.get('/api/auth/session', (req: Request, res: Response) => {
  const user = getStrictAuthenticatedUser(req);
  if (!user) {
    return res.json({ authenticated: false, user: null });
  }
  const matchingDivisions = DIVISIONS.filter((d) => user.divisionIds?.includes(d.id));
  res.json({ authenticated: true, user, divisions: matchingDivisions });
});

// 7. Get College Divisions
app.get('/api/divisions', (_req: Request, res: Response) => {
  res.json({ divisions: DIVISIONS });
});

// 8. Admin: Get Approved Student Roster & Division Report
app.get('/api/admin/approved-students', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (!currentUser || currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative privileges required to inspect approved student roster.' });
  }

  const search = ((req.query.search as string) || '').toLowerCase().trim();
  const divisionId = (req.query.divisionId as string) || 'all';

  let list = Array.from(approvedStudentsMap.values());

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
  const allList = Array.from(approvedStudentsMap.values());
  const report = {
    totalSuppliedDivisionA: allList.filter((s) => s.divisionIds.includes('sy-aids-a')).length,
    totalSuppliedDivisionB: allList.filter((s) => s.divisionIds.includes('sy-aids-b')).length,
    totalSuppliedEntries: initialApprovedDatasetReport.totalSuppliedEntries,
    uniqueAddressesOverall: allList.length,
    sharedAddressesCount: allList.filter((s) => s.divisionIds.length > 1).length,
    sharedAddresses: allList.filter((s) => s.divisionIds.length > 1).map((s) => s.email).sort(),
    divisionAOnlyCount: allList.filter((s) => s.divisionIds.includes('sy-aids-a') && !s.divisionIds.includes('sy-aids-b')).length,
    divisionBOnlyCount: allList.filter((s) => s.divisionIds.includes('sy-aids-b') && !s.divisionIds.includes('sy-aids-a')).length,
    malformedAddresses: [],
    registeredCount: allList.filter((s) => s.isRegistered).length,
    pendingActivationCount: allList.filter((s) => !s.isRegistered).length,
  };

  res.json({ students: list, report, total: list.length });
});

// 9. Admin: Add New Approved Student Email
app.post('/api/admin/approved-students', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (!currentUser || currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative privileges required.' });
  }

  const { email, divisionIds } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Student email is required.' });
  }

  const norm = normalizeEmail(email);
  if (!isValidEmailFormat(norm)) {
    return res.status(400).json({ error: 'Invalid email address format.' });
  }

  if (!Array.isArray(divisionIds) || divisionIds.length === 0) {
    return res.status(400).json({ error: 'At least one division must be assigned.' });
  }

  const now = new Date().toISOString();
  const existing = approvedStudentsMap.get(norm);

  if (existing) {
    existing.divisionIds = Array.from(new Set([...existing.divisionIds, ...divisionIds]));
    existing.status = 'authorized';
    existing.updatedAt = now;
  } else {
    approvedStudentsMap.set(norm, {
      email: norm,
      divisionIds,
      status: 'authorized',
      isRegistered: false,
      createdAt: now,
      updatedAt: now,
    });
  }

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

  res.status(201).json({
    student: approvedStudentsMap.get(norm),
    message: `Student ${norm} successfully authorized.`,
  });
});

// 10. Admin: Update Approved Student (toggle status, change division, or correct email)
app.put('/api/admin/approved-students/:email', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (!currentUser || currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative privileges required.' });
  }

  const norm = normalizeEmail(req.params.email);
  const student = approvedStudentsMap.get(norm);
  if (!student) {
    return res.status(404).json({ error: 'Student email not found in approved roster.' });
  }

  const { divisionIds, status, newEmail } = req.body;
  const now = new Date().toISOString();

  if (Array.isArray(divisionIds) && divisionIds.length > 0) {
    student.divisionIds = divisionIds;
  }

  if (status === 'authorized' || status === 'revoked') {
    student.status = status;
  }

  if (newEmail && typeof newEmail === 'string') {
    const cleanNew = normalizeEmail(newEmail);
    if (!isValidEmailFormat(cleanNew)) {
      return res.status(400).json({ error: 'New email format is invalid.' });
    }
    approvedStudentsMap.delete(norm);
    student.email = cleanNew;
    approvedStudentsMap.set(cleanNew, student);
  }

  student.updatedAt = now;

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

  res.json({ student, message: 'Student record updated.' });
});

// Current User Profile Endpoint
app.get('/api/me', (req: Request, res: Response) => {
  const user = getCurrentUser(req);
  res.json({ user });
});

app.get('/api/users', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;
  const filtered = users.filter((u) => u.institutionId === institutionId);
  const visibleUsers = currentUser.role === 'admin'
    ? filtered
    : filtered.map((user) => ({ ...user, phone: undefined }));
  res.json({ users: visibleUsers });
});

app.post('/api/users', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Only institutional administrators can register new accounts.' });
  }

  const { name, email, role, departmentId, course, year } = req.body;
  if (!name || !email || !role || !departmentId) {
    return res.status(400).json({ error: 'Missing mandatory registration fields.' });
  }

  // Validate email domain against institution
  const inst = institutions.find((i) => i.id === currentUser.institutionId);
  const emailDomain = email.split('@')[1];
  if (inst && !inst.allowedDomains.includes(emailDomain)) {
    return res.status(400).json({
      error: `Email domain @${emailDomain} is not authorized for ${inst.name}. Allowed: ${inst.allowedDomains.join(', ')}`,
    });
  }

  const newUser: User = {
    id: `user-${Date.now()}`,
    institutionId: currentUser.institutionId,
    name,
    email,
    role,
    departmentId,
    course,
    year,
    interests: ['Academics'],
    notificationPreferences: {
      academic: true,
      events: true,
      deadlines: true,
      clubs: true,
    },
    isVerified: true,
  };

  users.push(newUser);

  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'USER_REGISTERED',
    details: `Admin created verified account ${name} (${role}) with email ${email}`,
    timestamp: new Date().toISOString(),
  });

  res.status(201).json({ user: newUser });
});

app.put('/api/users/:id/role', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Administrative privileges required to modify user roles.' });
  }

  const { role } = req.body as { role: UserRole };
  const targetUser = users.find((u) => u.id === req.params.id);
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found.' });
  }

  targetUser.role = role;

  auditLogs.unshift({
    id: `log-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userRole: currentUser.role,
    action: 'USER_ROLE_UPDATED',
    details: `Updated role of ${targetUser.name} to ${role}`,
    timestamp: new Date().toISOString(),
  });

  res.json({ user: targetUser });
});

// Update user preferences & interests
app.put('/api/me/preferences', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const { interests, notificationPreferences, orderedPreferences } = req.body;

  if (Array.isArray(interests)) {
    currentUser.interests = interests;
  }
  if (Array.isArray(orderedPreferences)) {
    currentUser.orderedPreferences = orderedPreferences as [string, string, string];
  }
  if (notificationPreferences) {
    currentUser.notificationPreferences = {
      ...currentUser.notificationPreferences,
      ...notificationPreferences,
    };
  }

  res.json({ user: currentUser });
});

// 2. Institutions & Multi-tenancy
app.get('/api/institutions', (_req: Request, res: Response) => {
  res.json({ institutions });
});

app.get('/api/institutions/:id', (req: Request, res: Response) => {
  const inst = institutions.find((i) => i.id === req.params.id);
  if (!inst) return res.status(404).json({ error: 'Institution not found.' });
  res.json({ institution: inst });
});

app.put('/api/institutions/:id/settings', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Only administrators can update institutional settings.' });
  }

  const inst = institutions.find((i) => i.id === req.params.id);
  if (!inst) return res.status(404).json({ error: 'Institution not found.' });

  const { requireApproval, allowedDomains } = req.body;
  if (typeof requireApproval === 'boolean') inst.requireApproval = requireApproval;
  if (Array.isArray(allowedDomains)) inst.allowedDomains = allowedDomains;

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

  res.json({ institution: inst });
});

// 3. Departments
app.get('/api/departments', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;
  const filtered = departments.filter((d) => d.institutionId === institutionId);
  res.json({ departments: filtered });
});

app.post('/api/departments', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin permission required.' });
  }

  const { name, code, courses } = req.body;
  if (!name || !code) return res.status(400).json({ error: 'Name and Code are required.' });

  const newDept: Department = {
    id: `dept-${Date.now()}`,
    institutionId: currentUser.institutionId,
    name,
    code,
    courses: Array.isArray(courses) ? courses : [],
  };

  departments.push(newDept);
  res.status(201).json({ department: newDept });
});

// 4. Announcements
app.get('/api/announcements', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;
  if (institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot view announcements from another institution.' });
  }
  const category = req.query.category as string;
  const priority = req.query.priority as string;
  const search = (req.query.search as string || '').toLowerCase().trim();
  const sort = (req.query.sort as string) || 'relevant'; // relevant | latest | urgent | deadlines

  // Multi-tenant isolation: Only announcements for this institution
  let result = announcements.filter((a) => a.institutionId === institutionId);

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
app.get('/api/announcements/:id', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const item = announcements.find((a) => a.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Announcement not found.' });
  if (
    item.institutionId !== currentUser.institutionId ||
    (item.status !== 'published' && currentUser.role !== 'admin' && item.authorId !== currentUser.id) ||
    !canUserViewAnnouncement(currentUser, item)
  ) {
    return res.status(403).json({ error: 'You cannot view this announcement.' });
  }

  // Increment view metric
  item.metrics.views += 1;
  res.json({ announcement: item });
});

// Create announcement (strict role & tenant authorization)
app.post('/api/announcements', (req: Request, res: Response) => {
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

  if (!title || !description || !category) {
    return res.status(400).json({ error: 'Title, description, and category are mandatory.' });
  }

  const inst = institutions.find((i) => i.id === currentUser.institutionId);
  const requiresApproval = inst?.requireApproval && currentUser.role !== 'admin';

  const newAnnouncement: Announcement = {
    id: `ann-${Date.now()}`,
    institutionId: currentUser.institutionId,
    title,
    description,
    category,
    publishingDepartment: publishingDepartment || currentUser.departmentName || 'Department Notice',
    authorId: currentUser.id,
    authorName: currentUser.name,
    authorRole: currentUser.role,
    targetAudience: targetAudience || { type: 'all' },
    priority: priority || 'normal',
    status: requiresApproval ? 'pending_approval' : 'published',
    publicationDate: new Date().toISOString(),
    eventDate,
    eventLocation,
    registrationDeadline,
    registrationLink,
    attachments: Array.isArray(attachments) ? attachments : [],
    imageBanner,
    aiSummary,
    isPinned: false,
    isOfficial: currentUser.role === 'faculty' || currentUser.role === 'admin',
    metrics: { views: 0, saves: 0, registrations: 0 },
  };

  announcements.unshift(newAnnouncement);

  // Broadcast in-app notification if published immediately
  if (!requiresApproval) {
    users
      .filter((u) => u.institutionId === currentUser.institutionId && u.id !== currentUser.id)
      .forEach((u) => {
        if (announcementTargetsUser(u, newAnnouncement)) {
          notifications.unshift({
            id: `notif-${Date.now()}-${u.id}`,
            institutionId: currentUser.institutionId,
            userId: u.id,
            announcementId: newAnnouncement.id,
            title: newAnnouncement.priority === 'urgent' ? `🚨 Urgent: ${title}` : `New: ${title}`,
            message: `${newAnnouncement.publishingDepartment}: ${title.slice(0, 90)}...`,
            type: newAnnouncement.priority === 'urgent' ? 'urgent' : 'announcement',
            isRead: false,
            createdAt: new Date().toISOString(),
          });
          broadcastToUser(u.id, currentUser.institutionId, { type: 'notifications:changed' });
        }
      });
  } else {
    // Notify admins of pending announcement
    users
      .filter((u) => u.institutionId === currentUser.institutionId && u.role === 'admin')
      .forEach((adm) => {
        notifications.unshift({
          id: `notif-${Date.now()}-${adm.id}`,
          institutionId: currentUser.institutionId,
          userId: adm.id,
          announcementId: newAnnouncement.id,
          title: 'Review Required: Pending Announcement',
          message: `${currentUser.name} submitted "${title}" for publication approval.`,
          type: 'approval',
          isRead: false,
          createdAt: new Date().toISOString(),
        });
        broadcastToUser(adm.id, currentUser.institutionId, { type: 'notifications:changed' });
      });
  }

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

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'announcements:changed' });
  res.status(201).json({ announcement: newAnnouncement });
});

// Edit announcement
app.put('/api/announcements/:id', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const target = announcements.find((a) => a.id === req.params.id);

  if (!target) return res.status(404).json({ error: 'Announcement not found.' });

  // Faculty can edit institutional announcements; other roles may only edit their own.
  if (
    target.institutionId !== currentUser.institutionId ||
    (target.authorId !== currentUser.id && currentUser.role !== 'admin' && currentUser.role !== 'faculty')
  ) {
    return res.status(403).json({ error: 'You are not authorized to edit this announcement.' });
  }

  const updates = req.body;
  Object.assign(target, {
    title: updates.title ?? target.title,
    description: updates.description ?? target.description,
    category: updates.category ?? target.category,
    publishingDepartment: updates.publishingDepartment ?? target.publishingDepartment,
    targetAudience: updates.targetAudience ?? target.targetAudience,
    priority: updates.priority ?? target.priority,
    eventDate: updates.eventDate ?? target.eventDate,
    eventLocation: updates.eventLocation ?? target.eventLocation,
    registrationDeadline: updates.registrationDeadline ?? target.registrationDeadline,
    registrationLink: updates.registrationLink ?? target.registrationLink,
    attachments: updates.attachments ?? target.attachments,
    imageBanner: updates.imageBanner ?? target.imageBanner,
    aiSummary: updates.aiSummary ?? target.aiSummary,
    isPinned: updates.isPinned ?? target.isPinned,
  });

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

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'announcements:changed' });
  res.json({ announcement: target });
});

// Admin Approve / Reject announcement
app.post('/api/announcements/:id/approve', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin authorization required to approve announcements.' });
  }

  const target = announcements.find((a) => a.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Announcement not found.' });

  target.status = 'published';

  // Notify author that announcement is approved
  notifications.unshift({
    id: `notif-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: target.authorId,
    announcementId: target.id,
    title: 'Announcement Approved',
    message: `Your announcement "${target.title}" has been approved and published to the student portal.`,
    type: 'announcement',
    isRead: false,
    createdAt: new Date().toISOString(),
  });
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

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'announcements:changed' });
  res.json({ announcement: target });
});

app.post('/api/announcements/:id/reject', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin authorization required.' });
  }

  const target = announcements.find((a) => a.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Announcement not found.' });

  const { reason } = req.body;
  target.status = 'archived';

  notifications.unshift({
    id: `notif-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: target.authorId,
    announcementId: target.id,
    title: 'Announcement Declined',
    message: `Your submission "${target.title}" was declined: ${reason || 'Does not meet institutional posting guidelines.'}`,
    type: 'approval',
    isRead: false,
    createdAt: new Date().toISOString(),
  });
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

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'announcements:changed' });
  res.json({ announcement: target });
});

// Delete or Archive announcement
app.delete('/api/announcements/:id', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const index = announcements.findIndex((a) => a.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Announcement not found.' });

  const target = announcements[index];
  if (target.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot delete announcements from another institution.' });
  }
  if (target.authorId !== currentUser.id && currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized to delete this announcement.' });
  }

  announcements.splice(index, 1);

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

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'announcements:changed' });
  res.json({ success: true });
});

// Save / Bookmark announcement
app.post('/api/announcements/:id/save', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const annId = req.params.id;
  const target = announcements.find((a) => a.id === annId);
  if (!target) return res.status(404).json({ error: 'Announcement not found.' });

  if (!savedAnnouncementsByUser[currentUser.id]) {
    savedAnnouncementsByUser[currentUser.id] = [];
  }

  const list = savedAnnouncementsByUser[currentUser.id];
  const isSaved = list.includes(annId);

  if (isSaved) {
    savedAnnouncementsByUser[currentUser.id] = list.filter((id) => id !== annId);
    target.metrics.saves = Math.max(0, target.metrics.saves - 1);
  } else {
    list.push(annId);
    target.metrics.saves += 1;
  }

  res.json({ isSaved: !isSaved, savedIds: savedAnnouncementsByUser[currentUser.id] });
});

app.get('/api/saved-announcements', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const ids = savedAnnouncementsByUser[currentUser.id] || [];
  const saved = announcements.filter((a) => ids.includes(a.id) && a.status === 'published');
  res.json({ announcements: saved, savedIds: ids });
});

// 5. Event Registrations & Applications
app.get('/api/registrations', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const userRegs = registrations.filter(
    (r) => r.userId === currentUser.id && r.institutionId === currentUser.institutionId
  );
  res.json({ registrations: userRegs });
});

app.post('/api/registrations', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const { announcementId } = req.body;

  const ann = announcements.find((a) => a.id === announcementId);
  if (!ann) return res.status(404).json({ error: 'Announcement / event not found.' });

  // Check if already registered
  const existing = registrations.find((r) => r.userId === currentUser.id && r.announcementId === announcementId);
  if (existing) {
    return res.status(400).json({ error: 'You are already registered for this event or activity.' });
  }

  const inst = institutions.find((i) => i.id === currentUser.institutionId);
  const prefix = inst ? inst.shortName.toUpperCase().replace(/\s+/g, '') : 'MYCOLLEGE';
  const ticketCode = `${prefix}-REG-${Math.floor(10000 + Math.random() * 90000)}`;

  const newReg: EventRegistration = {
    id: `reg-${Date.now()}`,
    announcementId: ann.id,
    announcementTitle: ann.title,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    userName: currentUser.name,
    userEmail: currentUser.email,
    registeredAt: new Date().toISOString(),
    status: 'confirmed',
    ticketCode,
  };

  registrations.unshift(newReg);
  ann.metrics.registrations += 1;

  // Add confirmation notification
  notifications.unshift({
    id: `notif-${Date.now()}`,
    institutionId: currentUser.institutionId,
    userId: currentUser.id,
    announcementId: ann.id,
    title: 'Registration Confirmed',
    message: `You are registered for "${ann.title}". Ticket: ${ticketCode}`,
    type: 'registration',
    isRead: false,
    createdAt: new Date().toISOString(),
  });
  broadcastToUser(currentUser.id, currentUser.institutionId, { type: 'notifications:changed' });
  broadcastToUser(currentUser.id, currentUser.institutionId, { type: 'registrations:changed' });

  res.status(201).json({ registration: newReg });
});

app.delete('/api/registrations/:id', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const index = registrations.findIndex((r) => r.id === req.params.id && r.userId === currentUser.id);
  if (index === -1) return res.status(404).json({ error: 'Registration not found.' });

  const target = registrations[index];
  const ann = announcements.find((a) => a.id === target.announcementId);
  if (ann) {
    ann.metrics.registrations = Math.max(0, ann.metrics.registrations - 1);
  }

  registrations.splice(index, 1);
  broadcastToUser(currentUser.id, currentUser.institutionId, { type: 'registrations:changed' });
  res.json({ success: true });
});

// 6. Notifications
app.get('/api/notifications', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const list = notifications.filter(
    (n) => n.userId === currentUser.id && n.institutionId === currentUser.institutionId
  );
  res.json({ notifications: list });
});

app.put('/api/notifications/:id/read', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const notif = notifications.find((n) => n.id === req.params.id && n.userId === currentUser.id);
  if (notif) notif.isRead = true;
  res.json({ success: true, notification: notif });
});

app.put('/api/notifications/mark-all-read', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  notifications
    .filter((n) => n.userId === currentUser.id && n.institutionId === currentUser.institutionId)
    .forEach((n) => (n.isRead = true));
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

app.get('/api/audit-logs', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  if (currentUser.role !== 'admin') {
    return res.status(403).json({ error: 'Only administrators can inspect institutional audit logs.' });
  }

  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;
  const logs = auditLogs.filter((l) => l.institutionId === institutionId);
  res.json({ auditLogs: logs });
});

// 9. Real-Time Chat Channels & Messaging API
app.get('/api/channels', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;
  if (institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot view another institution’s groups.' });
  }
  const type = req.query.type as string;

  let list = chatChannels.filter((c) => c.institutionId === institutionId);

  // Enforce division authorization on channel access
  list = list.filter((c) => {
    if (!c.divisionId) return true; // public / general circle
    if (currentUser.role === 'admin' || currentUser.role === 'faculty') return true;
    return currentUser.divisionIds && currentUser.divisionIds.includes(c.divisionId);
  });

  if (type && type !== 'all') {
    list = list.filter((c) => c.type === type);
  }
  res.json({ channels: list });
});

app.post('/api/channels', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const { name, title, description, type, pinnedAnnouncementId } = req.body;

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
  if (currentUser.role !== 'faculty' && currentUser.role !== 'admin' && currentUser.role !== 'coordinator') {
    return res.status(403).json({ error: 'Only faculty, coordinators, or administrators can create groups.' });
  }

  const isOfficial = type === 'class' && (currentUser.role === 'faculty' || currentUser.role === 'admin');
  const cleanName = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-');

  const newChannel: ChatChannel = {
    id: `chan-${Date.now()}`,
    institutionId: currentUser.institutionId,
    name: cleanName,
    title,
    description: description || `College ${type} discussion circle`,
    type: type || 'interest',
    isOfficial,
    memberCount: 1,
    creatorId: currentUser.id,
    adminIds: [currentUser.id],
    memberIds: [currentUser.id],
    pinnedAnnouncementId: pinnedAnnouncementId || undefined,
  };

  chatChannels.push(newChannel);

  broadcastToInstitutionUsers(currentUser.institutionId, { type: 'channels:changed' });

  res.status(201).json({ channel: newChannel });
});

app.get('/api/channels/:id/messages', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot access another institution’s group.' });
  }

  // Enforce division authorization
  if (channel.divisionId && currentUser.role !== 'admin' && currentUser.role !== 'faculty') {
    if (!currentUser.divisionIds || !currentUser.divisionIds.includes(channel.divisionId)) {
      return res.status(403).json({ error: 'Access denied. You do not belong to this division.' });
    }
  }

  const msgs = chatMessages.filter((m) => m.channelId === req.params.id);
  res.json({ messages: msgs });
});

app.post('/api/channels/:id/messages', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot access another institution’s group.' });
  }

  // Enforce division authorization
  if (channel.divisionId && currentUser.role !== 'admin' && currentUser.role !== 'faculty') {
    if (!currentUser.divisionIds || !currentUser.divisionIds.includes(channel.divisionId)) {
      return res.status(403).json({ error: 'Access denied. You cannot send messages in another division.' });
    }
  }

  const isCircleAdmin =
    channel.creatorId === currentUser.id ||
    (channel.adminIds && channel.adminIds.includes(currentUser.id)) ||
    currentUser.role === 'admin' ||
    currentUser.role === 'faculty';

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
    id: `msg-${Date.now()}`,
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

  chatMessages.push(newMsg);

  channel.lastMessage = {
    senderName: currentUser.name,
    text: poll ? `📊 Poll: ${poll.question}` : attachment ? `📎 ${attachment.name}` : sanitizedContent.slice(0, 80),
    timestamp: newMsg.timestamp,
  };

  broadcastToInstitution(currentUser.institutionId, {
    type: 'message:new',
    message: newMsg,
    channelId: channel.id,
  });

  res.status(201).json({ message: newMsg });
});

// WhatsApp Reaction: Toggle emoji reaction on a message
app.post('/api/channels/:id/messages/:msgId/reactions', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((candidate) => candidate.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }
  const msg = chatMessages.find((m) => m.id === req.params.msgId && m.channelId === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });

  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'Emoji is required.' });

  if (!msg.reactions) msg.reactions = {};
  const usersForEmoji = msg.reactions[emoji] || [];

  if (usersForEmoji.includes(currentUser.id)) {
    // Remove reaction
    msg.reactions[emoji] = usersForEmoji.filter((uid) => uid !== currentUser.id);
    if (msg.reactions[emoji].length === 0) {
      delete msg.reactions[emoji];
    }
  } else {
    // Add reaction
    msg.reactions[emoji] = [...usersForEmoji, currentUser.id];
  }

  broadcastToInstitution(currentUser.institutionId, {
    type: 'message:reaction',
    channelId: req.params.id,
    messageId: msg.id,
    reactions: msg.reactions,
  });

  res.json({ success: true, message: msg });
});

// WhatsApp Pin/Unpin Message in Group
app.post('/api/channels/:id/messages/:msgId/pin', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const msg = chatMessages.find((m) => m.id === req.params.msgId && m.channelId === channel.id);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });

  const { isPinned } = req.body;
  msg.isPinned = Boolean(isPinned);
  channel.pinnedMessageId = isPinned ? msg.id : undefined;

  broadcastToInstitution(currentUser.institutionId, {
    type: 'message:pinned',
    channelId: channel.id,
    messageId: msg.id,
    isPinned: msg.isPinned,
  });

  res.json({ success: true, message: msg, channel });
});

// WhatsApp Delete Message (For everyone or sender)
app.delete('/api/channels/:id/messages/:msgId', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const msg = chatMessages.find((m) => m.id === req.params.msgId && m.channelId === channel.id);
  if (!msg) return res.status(404).json({ error: 'Message not found.' });

  const isCircleAdmin =
    channel.creatorId === currentUser.id ||
    (channel.adminIds && channel.adminIds.includes(currentUser.id)) ||
    currentUser.role === 'admin' ||
    currentUser.role === 'faculty';

  if (msg.senderId !== currentUser.id && !isCircleAdmin) {
    return res.status(403).json({ error: 'You can only delete your own messages or be a group admin.' });
  }

  msg.deleted = true;
  msg.content = '🚫 This message was deleted';
  msg.attachment = undefined;
  msg.poll = undefined;

  broadcastToInstitution(currentUser.institutionId, {
    type: 'message:deleted',
    channelId: channel.id,
    messageId: msg.id,
  });

  res.json({ success: true, message: msg });
});

// WhatsApp Poll Creation & Voting
app.post('/api/channels/:id/polls', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin =
    channel.creatorId === currentUser.id ||
    (channel.adminIds && channel.adminIds.includes(currentUser.id)) ||
    currentUser.role === 'admin' ||
    currentUser.role === 'faculty';

  if (channel.onlyAdminsCanMessage && !isCircleAdmin) {
    return res.status(403).json({ error: 'Only group admins can post polls in this group.' });
  }

  const { question, options, multipleAnswers } = req.body;
  if (!question || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'Poll requires a question and at least 2 options.' });
  }

  const poll: ChatPoll = {
    id: `poll-${Date.now()}`,
    question: question.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    options: options.map((opt: string, idx: number) => ({
      id: `opt-${idx}-${Date.now()}`,
      text: opt.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      votes: [],
    })),
    multipleAnswers: Boolean(multipleAnswers),
    createdAt: new Date().toISOString(),
  };

  const newMsg: ChatMessage = {
    id: `msg-poll-${Date.now()}`,
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

  chatMessages.push(newMsg);

  channel.lastMessage = {
    senderName: currentUser.name,
    text: `📊 Poll: ${poll.question.slice(0, 60)}`,
    timestamp: newMsg.timestamp,
  };

  broadcastToInstitution(currentUser.institutionId, {
    type: 'message:new',
    message: newMsg,
    channelId: channel.id,
  });

  res.status(201).json({ message: newMsg });
});

// Vote on a WhatsApp Group Poll
app.post('/api/channels/:id/messages/:msgId/vote', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((candidate) => candidate.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }
  const msg = chatMessages.find((m) => m.id === req.params.msgId && m.channelId === req.params.id);
  if (!msg || !msg.poll) return res.status(404).json({ error: 'Poll message not found.' });

  const { optionId } = req.body;
  const poll = msg.poll;
  const targetOption = poll.options.find((o) => o.id === optionId);
  if (!targetOption) return res.status(404).json({ error: 'Poll option not found.' });

  const hasVotedThis = targetOption.votes.includes(currentUser.id);

  if (poll.multipleAnswers) {
    // Toggle on this option
    if (hasVotedThis) {
      targetOption.votes = targetOption.votes.filter((uid) => uid !== currentUser.id);
    } else {
      targetOption.votes.push(currentUser.id);
    }
  } else {
    // Single choice: remove user from all other options
    poll.options.forEach((o) => {
      o.votes = o.votes.filter((uid) => uid !== currentUser.id);
    });
    if (!hasVotedThis) {
      targetOption.votes.push(currentUser.id);
    }
  }

  broadcastToInstitution(currentUser.institutionId, {
    type: 'poll:updated',
    channelId: req.params.id,
    messageId: msg.id,
    poll: msg.poll,
  });

  res.json({ success: true, poll: msg.poll, message: msg });
});

// 10. Channel Members & Admin Management (Make Admin, Dismiss Admin, Permissions)
app.get('/api/channels/:id/members', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot view another institution’s group.' });
  }

  const memberIds = channel.memberIds || [];
  const members = users.filter((u) => memberIds.includes(u.id));

  res.json({
    members,
    creatorId: channel.creatorId,
    adminIds: channel.adminIds || [],
    onlyAdminsCanMessage: channel.onlyAdminsCanMessage || false,
    onlyAdminsCanEditInfo: channel.onlyAdminsCanEditInfo || false,
    inviteCode: channel.inviteCode || `JOIN-${channel.id}`,
    inviteLink: `${req.protocol}://${req.get('host')}/circle/join/${channel.id}?code=${channel.inviteCode || 'INVITE'}`,
  });
});

// Make someone Group Admin (WhatsApp Group Admin feature)
app.post('/api/channels/:id/admins', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin =
    channel.creatorId === currentUser.id ||
    (channel.adminIds && channel.adminIds.includes(currentUser.id)) ||
    currentUser.role === 'admin' ||
    currentUser.role === 'faculty';

  if (!isCircleAdmin) {
    return res.status(403).json({ error: 'Only group admins can appoint new admins.' });
  }

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  const targetUser = users.find((u) => u.id === userId);
  if (!targetUser) return res.status(404).json({ error: 'User not found.' });

  if (!channel.adminIds) channel.adminIds = [];
  if (!channel.adminIds.includes(userId)) {
    channel.adminIds.push(userId);
  }

  // Add system message
  const sysMsg: ChatMessage = {
    id: `msg-sys-${Date.now()}`,
    channelId: channel.id,
    institutionId: currentUser.institutionId,
    senderId: 'system',
    senderName: 'Group Security',
    senderRole: 'admin',
    content: `🛡️ ${targetUser.name} was appointed as Group Admin by ${currentUser.name}.`,
    timestamp: new Date().toISOString(),
  };
  chatMessages.push(sysMsg);

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
app.delete('/api/channels/:id/admins/:userId', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin =
    channel.creatorId === currentUser.id ||
    (channel.adminIds && channel.adminIds.includes(currentUser.id)) ||
    currentUser.role === 'admin' ||
    currentUser.role === 'faculty';

  if (!isCircleAdmin) {
    return res.status(403).json({ error: 'Only group admins can dismiss other admins.' });
  }

  const targetUserId = req.params.userId;
  const targetUser = users.find((u) => u.id === targetUserId);

  if (channel.adminIds) {
    channel.adminIds = channel.adminIds.filter((id) => id !== targetUserId);
  }

  // System notice
  const sysMsg: ChatMessage = {
    id: `msg-sys-${Date.now()}`,
    channelId: channel.id,
    institutionId: currentUser.institutionId,
    senderId: 'system',
    senderName: 'Group Security',
    senderRole: 'admin',
    content: `ℹ️ ${targetUser ? targetUser.name : 'Participant'} is no longer a Group Admin.`,
    timestamp: new Date().toISOString(),
  };
  chatMessages.push(sysMsg);

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
app.put('/api/channels/:id/settings', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin =
    channel.creatorId === currentUser.id ||
    (channel.adminIds && channel.adminIds.includes(currentUser.id)) ||
    currentUser.role === 'admin' ||
    currentUser.role === 'faculty';

  if (channel.onlyAdminsCanEditInfo && !isCircleAdmin) {
    return res.status(403).json({ error: 'Only group admins can edit this group settings.' });
  }

  const { title, description, onlyAdminsCanMessage, onlyAdminsCanEditInfo, groupIcon } = req.body;

  if (title !== undefined && title.trim()) {
    channel.title = title.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  if (description !== undefined) {
    channel.description = description.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  if (groupIcon !== undefined) {
    channel.groupIcon = groupIcon;
  }
  if (onlyAdminsCanMessage !== undefined && isCircleAdmin) {
    channel.onlyAdminsCanMessage = Boolean(onlyAdminsCanMessage);
  }
  if (onlyAdminsCanEditInfo !== undefined && isCircleAdmin) {
    channel.onlyAdminsCanEditInfo = Boolean(onlyAdminsCanEditInfo);
  }

  broadcastToInstitution(currentUser.institutionId, {
    type: 'channel:updated',
    channel,
  });

  res.json({ success: true, channel });
});

// Reset Invite Code
app.post('/api/channels/:id/reset-invite', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin =
    channel.creatorId === currentUser.id ||
    (channel.adminIds && channel.adminIds.includes(currentUser.id)) ||
    currentUser.role === 'admin' ||
    currentUser.role === 'faculty';

  if (!isCircleAdmin) {
    return res.status(403).json({ error: 'Only group admins can reset the invite link.' });
  }

  channel.inviteCode = `JOIN-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  res.json({
    success: true,
    inviteCode: channel.inviteCode,
    inviteLink: `${req.protocol}://${req.get('host')}/circle/join/${channel.id}?code=${channel.inviteCode}`,
  });
});

app.post('/api/channels/:id/members', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin =
    channel.creatorId === currentUser.id ||
    (channel.adminIds && channel.adminIds.includes(currentUser.id)) ||
    currentUser.role === 'admin' ||
    currentUser.role === 'faculty';

  // Allow group members & institutional peers to add classmates unless admin-only lock is enabled
  if (channel.onlyAdminsCanEditInfo && !isCircleAdmin) {
    return res.status(403).json({ error: 'Only group admins can add new participants in this circle.' });
  }

  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required.' });

  const targetUser = users.find((u) => u.id === userId);
  if (!targetUser) return res.status(404).json({ error: 'Student/user not found.' });
  if (targetUser.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot add a user from another institution.' });
  }

  if (!channel.memberIds) channel.memberIds = [];
  if (!channel.memberIds.includes(targetUser.id)) {
    channel.memberIds.push(targetUser.id);
    channel.memberCount = channel.memberIds.length;
  }

  // Add system welcome message
  const sysMsg: ChatMessage = {
    id: `msg-sys-${Date.now()}`,
    channelId: channel.id,
    institutionId: currentUser.institutionId,
    senderId: 'system',
    senderName: 'Campus Bot',
    senderRole: 'admin',
    content: `${targetUser.name} (${targetUser.role}) was added to #${channel.name} by ${currentUser.name}.`,
    timestamp: new Date().toISOString(),
  };
  chatMessages.push(sysMsg);

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

  res.json({ success: true, member: targetUser, memberCount: channel.memberCount });
});

app.delete('/api/channels/:id/members/:userId', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot update another institution’s group.' });
  }

  const isCircleAdmin =
    channel.creatorId === currentUser.id ||
    (channel.adminIds && channel.adminIds.includes(currentUser.id)) ||
    currentUser.role === 'admin';

  const isRemovingSelf = req.params.userId === currentUser.id;

  if (!isCircleAdmin && !isRemovingSelf) {
    return res.status(403).json({ error: 'Permission denied.' });
  }

  const targetUser = users.find((u) => u.id === req.params.userId);

  if (channel.memberIds) {
    channel.memberIds = channel.memberIds.filter((id) => id !== req.params.userId);
    channel.memberCount = Math.max(1, channel.memberIds.length);
  }
  if (channel.adminIds) {
    channel.adminIds = channel.adminIds.filter((id) => id !== req.params.userId);
  }

  // Add departure system message
  const sysMsg: ChatMessage = {
    id: `msg-sys-${Date.now()}`,
    channelId: channel.id,
    institutionId: currentUser.institutionId,
    senderId: 'system',
    senderName: 'Campus Bot',
    senderRole: 'admin',
    content: isRemovingSelf
      ? `${currentUser.name} left the group.`
      : `${targetUser ? targetUser.name : 'Participant'} was removed by ${currentUser.name}.`,
    timestamp: new Date().toISOString(),
  };
  chatMessages.push(sysMsg);

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

app.post('/api/channels/:id/join', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot join another institution’s group.' });
  }

  if (!channel.memberIds) channel.memberIds = [];
  if (!channel.memberIds.includes(currentUser.id)) {
    channel.memberIds.push(currentUser.id);
    channel.memberCount = channel.memberIds.length;

    const joinMsg: ChatMessage = {
      id: `msg-join-${Date.now()}`,
      channelId: channel.id,
      institutionId: currentUser.institutionId,
      senderId: 'system',
      senderName: 'Campus Bot',
      senderRole: 'admin',
      content: `${currentUser.name} joined #${channel.name} via invite link.`,
      timestamp: new Date().toISOString(),
    };
    chatMessages.push(joinMsg);

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
app.get('/api/channels/:id/announcements', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot view another institution’s group announcements.' });
  }

  const list = circleAnnouncements.filter((a) => a.channelId === channel.id);
  res.json({ announcements: list });
});

app.post('/api/channels/:id/announcements', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const channel = chatChannels.find((c) => c.id === req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found.' });
  if (channel.institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot post in another institution’s group.' });
  }

  const isCircleAdmin =
    channel.creatorId === currentUser.id ||
    (channel.adminIds && channel.adminIds.includes(currentUser.id)) ||
    currentUser.role === 'admin' ||
    currentUser.role === 'faculty' ||
    currentUser.role === 'coordinator';

  if (!isCircleAdmin) {
    return res.status(403).json({
      error: 'Only circle administrators, faculty, or coordinators can broadcast official announcements in this circle.',
    });
  }

  const { title, content, priority, deadline, attachment } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required for circle announcements.' });
  }

  // 1. Create Circle Announcement
  const newCircleAnn: CircleAnnouncement = {
    id: `cann-${Date.now()}`,
    channelId: channel.id,
    institutionId: currentUser.institutionId,
    title,
    content,
    authorId: currentUser.id,
    authorName: currentUser.name,
    authorRole: currentUser.role,
    timestamp: new Date().toISOString(),
    priority: priority || 'normal',
    deadline,
    attachment,
  };

  circleAnnouncements.unshift(newCircleAnn);

  // 2. Also publish to campus announcement feed so it is visible in the main Announcement Board!
  const campusAnn: Announcement = {
    id: `ann-${Date.now()}`,
    institutionId: currentUser.institutionId,
    title: `[${channel.title}] ${title}`,
    description: content,
    category: channel.type === 'class' ? 'academics' : channel.type === 'club' ? 'clubs' : 'general',
    publishingDepartment: channel.title,
    authorId: currentUser.id,
    authorName: currentUser.name,
    authorRole: currentUser.role,
    targetAudience: { type: 'all' },
    priority: priority || 'normal',
    status: 'published',
    publicationDate: new Date().toISOString(),
    registrationDeadline: deadline,
    isPinned: priority === 'urgent',
    isOfficial: currentUser.role === 'faculty' || currentUser.role === 'admin',
    metrics: { views: 1, saves: 0, registrations: 0 },
  };

  announcements.unshift(campusAnn);
  newCircleAnn.announcementId = campusAnn.id;

  // 3. Post a broadcast notification into the chat stream as well
  const broadcastChatMsg: ChatMessage = {
    id: `msg-ann-${Date.now()}`,
    channelId: channel.id,
    institutionId: currentUser.institutionId,
    senderId: currentUser.id,
    senderName: currentUser.name,
    senderRole: currentUser.role,
    senderDepartment: currentUser.departmentName,
    content: `📢 OFFICIAL CIRCLE ANNOUNCEMENT:\n\n**${title}**\n\n${content}`,
    timestamp: new Date().toISOString(),
    isPinned: true,
  };
  chatMessages.push(broadcastChatMsg);

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
app.get('/api/batch-directory', (req: Request, res: Response) => {
  const currentUser = getCurrentUser(req);
  const institutionId = (req.query.institutionId as string) || currentUser.institutionId;
  if (institutionId !== currentUser.institutionId) {
    return res.status(403).json({ error: 'You cannot view another institution’s batch summary.' });
  }
  const departmentId = req.query.departmentId as string;
  const division = req.query.division as string;
  const year = req.query.year as string;

  let list = users.filter((u) => u.institutionId === institutionId && u.role === 'student');

  if (departmentId && departmentId !== 'all') {
    list = list.filter((u) => u.departmentId === departmentId);
  }
  if (division && division !== 'all') {
    const divisionId = division === 'Div A' ? 'sy-aids-a' : division === 'Div B' ? 'sy-aids-b' : null;
    list = list.filter(
      (u) => u.division === division || (divisionId !== null && u.divisionIds?.includes(divisionId))
    );
  }
  if (year && year !== 'all') {
    const matchingYears = year === '2nd Year' || year === 'Second Year' ? ['2nd Year', 'Second Year'] : [year];
    list = list.filter((u) => u.year !== undefined && matchingYears.includes(u.year));
  }

  res.json({ total: list.length });
});

app.post('/api/batch-directory/students', (req: Request, res: Response) => {
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
  if (users.some((user) => normalizeEmail(user.email) === cleanEmail)) {
    return res.status(409).json({ error: 'A user with this email address already exists.' });
  }
  if (users.some(
    (user) =>
      user.institutionId === currentUser.institutionId &&
      user.rollNo?.toLowerCase() === cleanRollNo.toLowerCase()
  )) {
    return res.status(409).json({ error: 'A student with this roll number already exists.' });
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

  const divisionId = cleanDivision === 'Div A' ? 'sy-aids-a' : 'sy-aids-b';
  const divisionName = DIVISIONS.find((item) => item.id === divisionId)?.name || cleanDivision;
  const user: User = {
    id: `user-${crypto.randomUUID()}`,
    institutionId: currentUser.institutionId,
    name: cleanName,
    email: cleanEmail,
    role: 'student',
    departmentId: department.id,
    departmentName: department.name,
    course: department.courses[0],
    year: cleanYear,
    division: cleanDivision,
    divisionIds: [divisionId],
    divisionNames: [divisionName],
    rollNo: cleanRollNo,
    phone: cleanPhone || undefined,
    interests: ['Academics'],
    notificationPreferences: {
      academic: true,
      events: true,
      deadlines: true,
      clubs: true,
    },
    isVerified: true,
    isProfileCompleted: true,
  };
  users.push(user);

  const now = new Date().toISOString();
  approvedStudentsMap.set(cleanEmail, {
    email: cleanEmail,
    divisionIds: [divisionId],
    status: 'authorized',
    isRegistered: true,
    registeredUserId: user.id,
    registeredName: cleanName,
    createdAt: now,
    updatedAt: now,
  });

  const divisionChannel = chatChannels.find((channel) => channel.divisionId === divisionId);
  if (divisionChannel) {
    divisionChannel.memberIds ||= [];
    divisionChannel.memberIds.push(user.id);
    divisionChannel.memberCount = divisionChannel.memberIds.length;
  }

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

wss.on('connection', (ws) => {
  let isAuthenticated = false;
  const authTimeout = setTimeout(() => {
    if (!isAuthenticated) ws.close(1008, 'Authentication required');
  }, 5000);

  ws.on('message', (raw) => {
    let data: unknown;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      if (!isAuthenticated) ws.close(1008, 'Invalid authentication message');
      return;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      if (!isAuthenticated) ws.close(1008, 'Invalid authentication message');
      return;
    }
    const message = data as { type?: unknown; token?: unknown };

    if (!isAuthenticated) {
      const token = message.type === 'auth' && typeof message.token === 'string' ? message.token : '';
      const session = token ? activeSessions.get(token) : undefined;
      const user = session && Date.now() < session.expiresAt
        ? users.find((candidate) => candidate.id === session.userId)
        : undefined;

      if (!session || !user) {
        ws.close(1008, 'Authentication required');
        return;
      }

      isAuthenticated = true;
      clearTimeout(authTimeout);
      clientSockets.set(ws, token);
      ws.send(JSON.stringify({ type: 'auth:ok' }));
      return;
    }

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
    clearTimeout(authTimeout);
    clientSockets.delete(ws);
  });
});

function broadcastToInstitution(institutionId: string, payload: {
  channelId?: string;
  channel?: ChatChannel;
  [key: string]: unknown;
}) {
  const channelId = payload.channelId || payload.channel?.id;
  const channel = channelId ? chatChannels.find((item) => item.id === channelId) : undefined;
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

    const hasChannelAccess =
      !channel.divisionId ||
      user.role === 'admin' ||
      user.role === 'faculty' ||
      Boolean(channel.memberIds?.includes(user.id)) ||
      Boolean(user.divisionIds?.includes(channel.divisionId));

    if (hasChannelAccess && socket.readyState === WebSocket.OPEN) {
      socket.send(msg);
    }
  }
}

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, () => {
    console.log(`MyCollege Server & WebSockets running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
