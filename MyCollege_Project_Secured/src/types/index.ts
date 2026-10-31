export type UserRole = 'student' | 'faculty' | 'coordinator' | 'admin';

export type AnnouncementCategory =
  | 'academics'
  | 'examinations'
  | 'timetables'
  | 'sports'
  | 'fests'
  | 'events'
  | 'clubs'
  | 'hackathons'
  | 'internships'
  | 'assignments'
  | 'general';

export type PriorityLevel = 'urgent' | 'high' | 'normal' | 'low';

export type AnnouncementStatus = 'draft' | 'pending_approval' | 'published' | 'archived';

export interface TargetAudience {
  type: 'all' | 'department' | 'course' | 'year';
  departmentIds?: string[];
  years?: string[];
  courses?: string[];
}

export interface AnnouncementAttachment {
  id: string;
  name: string;
  size: string;
  type: string;
  url: string;
}

export interface AnnouncementMetrics {
  views: number;
  saves: number;
  registrations: number;
}

export interface Announcement {
  id: string;
  institutionId: string;
  title: string;
  description: string;
  category: AnnouncementCategory;
  publishingDepartment: string;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  targetAudience: TargetAudience;
  priority: PriorityLevel;
  status: AnnouncementStatus;
  publicationDate: string; // ISO date
  expiryDate?: string;
  eventDate?: string;
  eventLocation?: string;
  registrationDeadline?: string;
  registrationLink?: string;
  attachments?: AnnouncementAttachment[];
  isPinned?: boolean;
  isOfficial?: boolean;
  aiSummary?: string;
  imageBanner?: string;
  metrics: AnnouncementMetrics;
}

export interface UserNotificationPreferences {
  academic: boolean;
  events: boolean;
  deadlines: boolean;
  clubs: boolean;
}

export interface User {
  id: string;
  institutionId: string;
  name: string;
  email: string;
  username?: string;
  role: UserRole;
  departmentId: string;
  departmentName?: string;
  designation?: string;
  course?: string;
  year?: string;
  division?: string;
  divisionIds?: string[];
  divisionNames?: string[];
  rollNo?: string;
  phone?: string;
  assignedEntities?: string[]; // for coordinators: e.g. ['Coding Club', 'Sports Board']
  interests: string[];
  orderedPreferences?: [string, string, string]; // [1st: Most preferred, 2nd: Moderately preferred, 3rd: Least preferred]
  notificationPreferences: UserNotificationPreferences;
  avatar?: string;
  isVerified: boolean;
  isProfileCompleted?: boolean;
  termsAcceptedAt?: string;
}

export interface Department {
  id: string;
  institutionId: string;
  name: string;
  code: string;
  courses: string[];
}

export interface Institution {
  id: string;
  name: string;
  shortName: string;
  domain: string;
  allowedDomains: string[];
  requireApproval: boolean;
  city: string;
  established: string;
}

export interface AppNotification {
  id: string;
  institutionId: string;
  userId: string;
  announcementId?: string;
  title: string;
  message: string;
  type: 'announcement' | 'urgent' | 'deadline' | 'registration' | 'approval';
  isRead: boolean;
  createdAt: string;
}

export interface EventRegistration {
  id: string;
  announcementId: string;
  announcementTitle: string;
  institutionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  registeredAt: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled';
  ticketCode: string;
}

export interface AuditLog {
  id: string;
  institutionId: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: string;
  details: string;
  timestamp: string;
}

export interface PlatformStats {
  totalUsers: number;
  studentsCount: number;
  facultyCount: number;
  coordinatorsCount: number;
  activeAnnouncements: number;
  pendingApprovals: number;
  totalRegistrations: number;
  weeklyEngagementViews: number;
}

export type ChannelType = 'class' | 'club' | 'interest' | 'project';

export interface ChatChannel {
  id: string;
  institutionId: string;
  name: string;
  title: string;
  description: string;
  type: ChannelType;
  departmentId?: string;
  divisionId?: string;
  isOfficial: boolean;
  memberCount: number;
  creatorId?: string;
  adminIds?: string[];
  memberIds?: string[];
  inviteCode?: string;
  pinnedAnnouncementId?: string;
  pinnedMessageId?: string;
  groupIcon?: string;
  onlyAdminsCanMessage?: boolean;
  onlyAdminsCanEditInfo?: boolean;
  lastMessage?: {
    senderName: string;
    text: string;
    timestamp: string;
  };
  unreadCount?: number;
}

export interface CircleAnnouncement {
  id: string;
  channelId: string;
  announcementId?: string;
  institutionId: string;
  title: string;
  content: string;
  authorId: string;
  authorName: string;
  authorRole: UserRole;
  timestamp: string;
  priority: PriorityLevel;
  deadline?: string;
  attachment?: {
    name: string;
    size: string;
    type: string;
    url?: string;
    previewUrl?: string;
  };
}

export interface PollOption {
  id: string;
  text: string;
  votes: string[]; // userIds who voted
}

export interface ChatPoll {
  id: string;
  question: string;
  options: PollOption[];
  multipleAnswers?: boolean;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  institutionId: string;
  senderId: string;
  senderName: string;
  senderRole: UserRole;
  senderDepartment?: string;
  content: string;
  timestamp: string;
  attachment?: {
    name: string;
    size: string;
    type: string;
    url?: string;
    previewUrl?: string;
  };
  replyTo?: {
    id: string;
    senderName: string;
    content: string;
    attachmentName?: string;
  };
  reactions?: Record<string, string[]>; // emoji -> array of userIds
  poll?: ChatPoll;
  isPinned?: boolean;
  isStarred?: boolean;
  status?: 'sent' | 'delivered' | 'read';
  deleted?: boolean;
}

export interface Division {
  id: string;
  name: string;
  code: string;
  academicYear: string;
  department: string;
  status: 'active' | 'archived';
  description: string;
}

export interface ApprovedStudent {
  email: string;
  divisionIds: string[];
  status: 'authorized' | 'revoked';
  isRegistered: boolean;
  registeredUserId?: string;
  registeredName?: string;
  registeredUsername?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovedDatasetReport {
  totalSuppliedDivisionA: number;
  totalSuppliedDivisionB: number;
  totalSuppliedEntries: number;
  uniqueAddressesOverall: number;
  sharedAddressesCount: number;
  sharedAddresses: string[];
  divisionAOnlyCount: number;
  divisionBOnlyCount: number;
  malformedAddresses: string[];
}

export interface AuthSession {
  token: string;
  userId: string;
  email: string;
  expiresAt: number;
}
