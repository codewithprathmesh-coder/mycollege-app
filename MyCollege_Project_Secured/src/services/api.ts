import type {
  Announcement,
  AnnouncementCategory,
  AppNotification,
  ApprovedDatasetReport,
  ApprovedStudent,
  AuditLog,
  ChannelMemberCandidate,
  ChatMessage,
  Department,
  Division,
  EventRegistration,
  Institution,
  PlatformStats,
  PriorityLevel,
  User,
  UserRole,
} from '../types';

let currentUserId = localStorage.getItem('mycollege_active_user_id') || '';

export function getActiveUserId(): string {
  return currentUserId || localStorage.getItem('mycollege_active_user_id') || '';
}

export function setActiveUserId(userId: string) {
  currentUserId = userId;
  localStorage.setItem('mycollege_active_user_id', userId);
}

export function setSessionToken(token: string) {
  if (token) {
    localStorage.setItem('mycollege_session_token', token);
  }
}

export function getSessionToken(): string | null {
  return localStorage.getItem('mycollege_session_token');
}

export function clearSession() {
  currentUserId = '';
  localStorage.removeItem('mycollege_session_token');
  localStorage.removeItem('mycollege_active_user_id');
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getSessionToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('x-session-token', token);
  }

  const res = await fetch(endpoint, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (!res.ok) {
    let errorMsg = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data.error) errorMsg = data.error;
    } catch {
      // ignore json parse error
    }
    throw new Error(errorMsg);
  }

  return res.json();
}

export const api = {
  // User & Session
  async getMe(): Promise<{ user: User }> {
    return request('/api/me');
  },

  async getUsers(institutionId?: string): Promise<{ users: User[] }> {
    const q = institutionId ? `?institutionId=${institutionId}` : '';
    return request(`/api/users${q}`);
  },

  async updateUserRole(id: string, role: UserRole): Promise<{ user: User }> {
    return request(`/api/users/${id}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
  },

  async updatePreferences(payload: {
    interests?: string[];
    orderedPreferences?: [string, string, string];
    notificationPreferences?: Partial<User['notificationPreferences']>;
  }): Promise<{ user: User }> {
    return request('/api/me/preferences', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  // Institutions
  async getInstitutions(): Promise<{ institutions: Institution[] }> {
    return request('/api/institutions');
  },

  async getInstitution(id: string): Promise<{ institution: Institution }> {
    return request(`/api/institutions/${id}`);
  },

  async updateInstitutionSettings(
    id: string,
    settings: { requireApproval?: boolean; allowedDomains?: string[] }
  ): Promise<{ institution: Institution }> {
    return request(`/api/institutions/${id}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  // Departments
  async getDepartments(institutionId?: string): Promise<{ departments: Department[] }> {
    const q = institutionId ? `?institutionId=${institutionId}` : '';
    return request(`/api/departments${q}`);
  },

  // Announcements
  async getAnnouncements(params?: {
    category?: string;
    priority?: string;
    search?: string;
    sort?: string;
    institutionId?: string;
  }): Promise<{ announcements: Announcement[] }> {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.priority) query.set('priority', params.priority);
    if (params?.search) query.set('search', params.search);
    if (params?.sort) query.set('sort', params.sort);
    if (params?.institutionId) query.set('institutionId', params.institutionId);

    const qs = query.toString();
    return request(`/api/announcements${qs ? `?${qs}` : ''}`);
  },

  async getAnnouncement(id: string): Promise<{ announcement: Announcement }> {
    return request(`/api/announcements/${id}`);
  },

  async createAnnouncement(data: Partial<Announcement>): Promise<{ announcement: Announcement }> {
    return request('/api/announcements', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateAnnouncement(id: string, data: Partial<Announcement>): Promise<{ announcement: Announcement }> {
    return request(`/api/announcements/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deleteAnnouncement(id: string): Promise<{ success: boolean }> {
    return request(`/api/announcements/${id}`, {
      method: 'DELETE',
    });
  },

  async approveAnnouncement(id: string): Promise<{ announcement: Announcement }> {
    return request(`/api/announcements/${id}/approve`, {
      method: 'POST',
    });
  },

  async rejectAnnouncement(id: string, reason?: string): Promise<{ announcement: Announcement }> {
    return request(`/api/announcements/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async toggleSaveAnnouncement(id: string): Promise<{ isSaved: boolean; savedIds: string[] }> {
    return request(`/api/announcements/${id}/save`, {
      method: 'POST',
    });
  },

  async getSavedAnnouncements(): Promise<{ announcements: Announcement[]; savedIds: string[] }> {
    return request('/api/saved-announcements');
  },

  // Registrations
  async getRegistrations(): Promise<{ registrations: EventRegistration[] }> {
    return request('/api/registrations');
  },

  async registerForEvent(announcementId: string): Promise<{ registration: EventRegistration }> {
    return request('/api/registrations', {
      method: 'POST',
      body: JSON.stringify({ announcementId }),
    });
  },

  async cancelRegistration(id: string): Promise<{ success: boolean }> {
    return request(`/api/registrations/${id}`, {
      method: 'DELETE',
    });
  },

  // Notifications
  async getNotifications(): Promise<{ notifications: AppNotification[] }> {
    return request('/api/notifications');
  },

  async markNotificationRead(id: string): Promise<{ success: boolean }> {
    return request(`/api/notifications/${id}/read`, {
      method: 'PUT',
    });
  },

  async markAllNotificationsRead(): Promise<{ success: boolean }> {
    return request('/api/notifications/mark-all-read', {
      method: 'PUT',
    });
  },

  // AI Summarization
  async summarizeAnnouncement(
    title: string,
    description: string
  ): Promise<{ summary: string; source: string }> {
    return request('/api/summarize', {
      method: 'POST',
      body: JSON.stringify({ title, description }),
    });
  },

  // Admin stats & audit logs
  async getStats(institutionId?: string): Promise<{ stats: PlatformStats }> {
    const q = institutionId ? `?institutionId=${institutionId}` : '';
    return request(`/api/stats${q}`);
  },

  async getAuditLogs(institutionId?: string): Promise<{ auditLogs: AuditLog[] }> {
    const q = institutionId ? `?institutionId=${institutionId}` : '';
    return request(`/api/audit-logs${q}`);
  },

  // Real-Time Chat & Group Channels
  async getChannels(institutionId?: string, type?: string): Promise<{ channels: any[] }> {
    const params = new URLSearchParams();
    if (institutionId) params.set('institutionId', institutionId);
    if (type) params.set('type', type);
    const qs = params.toString();
    return request(`/api/channels${qs ? `?${qs}` : ''}`);
  },

  async createChannel(payload: {
    name: string;
    title: string;
    description?: string;
    type: string;
    pinnedAnnouncementId?: string;
  }): Promise<{ channel: any }> {
    return request('/api/channels', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async getMessages(channelId: string): Promise<{ messages: any[] }> {
    return request(`/api/channels/${channelId}/messages`);
  },

  async sendMessage(
    channelId: string,
    content: string,
    attachment?: { name: string; size: string; type: string; url?: string; previewUrl?: string },
    replyTo?: { id: string; senderName: string; content: string; attachmentName?: string }
  ): Promise<{ message: any }> {
    return request(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, attachment, replyTo }),
    });
  },

  async toggleMessageReaction(
    channelId: string,
    messageId: string,
    emoji: string
  ): Promise<{ success: boolean; message: any }> {
    return request(`/api/channels/${channelId}/messages/${messageId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
  },

  async pinMessage(
    channelId: string,
    messageId: string,
    isPinned: boolean
  ): Promise<{ success: boolean; message: any; channel: any }> {
    return request(`/api/channels/${channelId}/messages/${messageId}/pin`, {
      method: 'POST',
      body: JSON.stringify({ isPinned }),
    });
  },

  async deleteMessage(
    channelId: string,
    messageId: string
  ): Promise<{ success: boolean; message: any }> {
    return request(`/api/channels/${channelId}/messages/${messageId}`, {
      method: 'DELETE',
    });
  },

  async createPoll(
    channelId: string,
    payload: { question: string; options: string[]; multipleAnswers?: boolean }
  ): Promise<{ message: any }> {
    return request(`/api/channels/${channelId}/polls`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async votePoll(
    channelId: string,
    messageId: string,
    optionId: string
  ): Promise<{ success: boolean; poll: any; message: any }> {
    return request(`/api/channels/${channelId}/messages/${messageId}/vote`, {
      method: 'POST',
      body: JSON.stringify({ optionId }),
    });
  },

  // Circle Members & Admin Management (WhatsApp Group Features)
  async getChannelMembers(channelId: string): Promise<{
    members: any[];
    creatorId?: string;
    adminIds: string[];
    onlyAdminsCanMessage?: boolean;
    onlyAdminsCanEditInfo?: boolean;
    inviteCode: string;
    inviteLink: string;
  }> {
    return request(`/api/channels/${channelId}/members`);
  },

  async getChannelMemberCandidates(channelId: string): Promise<{ candidates: ChannelMemberCandidate[] }> {
    return request(`/api/channels/${channelId}/member-candidates`);
  },

  async makeGroupAdmin(channelId: string, userId: string): Promise<{ success: boolean; adminIds: string[]; user: any }> {
    return request(`/api/channels/${channelId}/admins`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  },

  async dismissGroupAdmin(channelId: string, userId: string): Promise<{ success: boolean; adminIds: string[] }> {
    return request(`/api/channels/${channelId}/admins/${userId}`, {
      method: 'DELETE',
    });
  },

  async updateGroupSettings(
    channelId: string,
    payload: {
      title?: string;
      description?: string;
      onlyAdminsCanMessage?: boolean;
      onlyAdminsCanEditInfo?: boolean;
      groupIcon?: string;
    }
  ): Promise<{ success: boolean; channel: any }> {
    return request(`/api/channels/${channelId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async resetInviteCode(channelId: string): Promise<{ success: boolean; inviteCode: string; inviteLink: string }> {
    return request(`/api/channels/${channelId}/reset-invite`, {
      method: 'POST',
    });
  },

  async addMemberToChannel(channelId: string, email: string): Promise<{
    success: boolean;
    member?: any;
    memberCount: number;
    pending?: boolean;
    message?: ChatMessage;
  }> {
    return request(`/api/channels/${channelId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async removeMemberFromChannel(channelId: string, userId: string): Promise<{ success: boolean; memberCount: number }> {
    return request(`/api/channels/${channelId}/members/${userId}`, {
      method: 'DELETE',
    });
  },

  async joinChannel(channelId: string): Promise<{ success: boolean; channel: any }> {
    return request(`/api/channels/${channelId}/join`, {
      method: 'POST',
    });
  },

  // Circle Announcements
  async getChannelAnnouncements(channelId: string): Promise<{ announcements: any[] }> {
    return request(`/api/channels/${channelId}/announcements`);
  },

  async createChannelAnnouncement(
    channelId: string,
    payload: {
      title: string;
      content: string;
      priority?: string;
      deadline?: string;
      attachment?: { name: string; size: string; type: string };
    }
  ): Promise<{ circleAnnouncement: any; campusAnnouncement: any }> {
    return request(`/api/channels/${channelId}/announcements`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Student Batch Directory
  async getBatchDirectory(params?: {
    departmentId?: string;
    division?: string;
    year?: string;
    institutionId?: string;
  }): Promise<{ total: number }> {
    const q = new URLSearchParams();
    if (params?.departmentId) q.set('departmentId', params.departmentId);
    if (params?.division) q.set('division', params.division);
    if (params?.year) q.set('year', params.year);
    if (params?.institutionId) q.set('institutionId', params.institutionId);
    const qs = q.toString();
    return request(`/api/batch-directory${qs ? `?${qs}` : ''}`);
  },

  async addBatchStudent(payload: {
    name: string;
    email: string;
    rollNo: string;
    departmentId: string;
    year: string;
    division: string;
    phone?: string;
  }): Promise<{ message: string }> {
    return request('/api/batch-directory/students', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // ----------------------------------------------------
  // SECURE AUTHENTICATION & APPROVED STUDENT MANAGEMENT
  // ----------------------------------------------------
  async requestOtp(email: string): Promise<{
    success: boolean;
    email: string;
    expiresInSeconds: number;
    deliveryNote: string;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      return await request('/api/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ email }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Verification email request timed out. Please try again later.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  },

  async checkAuthMethod(email: string): Promise<{
    exists: boolean;
    hasPassword: boolean;
  }> {
    return request('/api/auth/check-auth-method', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async loginWithPassword(
    email: string,
    password: string
  ): Promise<{
    user: User;
    token?: string;
    isFirstTime: boolean;
    divisions: Division[];
  }> {
    const res = await request<{
      user: User;
      token?: string;
      isFirstTime: boolean;
      divisions: Division[];
    }>('/api/auth/login-password', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (res.token) {
      setSessionToken(res.token);
    }
    setActiveUserId(res.user.id);
    return res;
  },

  async setPassword(payload: {
    email: string;
    password: string;
    token?: string;
  }): Promise<{ success: boolean; message: string }> {
    return request('/api/auth/set-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async changePassword(payload: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    return request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async verifyOtp(
    email: string,
    code: string
  ): Promise<{
    user: User;
    token?: string;
    isFirstTime: boolean;
    divisions: Division[];
    requiresPasswordSetup?: boolean;
  }> {
    const res = await request<{
      user: User;
      token?: string;
      isFirstTime: boolean;
      divisions: Division[];
      requiresPasswordSetup?: boolean;
    }>('/api/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
    if (res.token) {
      setSessionToken(res.token);
    }
    setActiveUserId(res.user.id);
    return res;
  },

  async checkUsername(username: string): Promise<{ available: boolean; message: string }> {
    return request(`/api/auth/check-username?username=${encodeURIComponent(username)}`);
  },

  async acceptTerms(): Promise<{ user: User; message: string }> {
    return request('/api/auth/accept-terms', {
      method: 'POST',
    });
  },

  async completeProfile(payload: {
    name: string;
    username: string;
    interests?: string[];
    avatar?: string;
  }): Promise<{ user: User; message: string }> {
    return request('/api/auth/complete-profile', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async logout(): Promise<{ success: boolean }> {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    } finally {
      clearSession();
    }
    return { success: true };
  },

  async getAuthSession(): Promise<{ authenticated: boolean; user: User | null; token?: string; divisions?: Division[] }> {
    const session = await request<{ authenticated: boolean; user: User | null; token?: string; divisions?: Division[] }>('/api/auth/session');
    if (session.user) setActiveUserId(session.user.id);
    if (session.token) setSessionToken(session.token);
    return session;
  },

  async getDivisions(): Promise<{ divisions: Division[] }> {
    return request('/api/divisions');
  },

  async getApprovedStudents(params?: {
    search?: string;
    divisionId?: string;
  }): Promise<{ students: ApprovedStudent[]; report: ApprovedDatasetReport; total: number }> {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.divisionId) q.set('divisionId', params.divisionId);
    const qs = q.toString();
    return request(`/api/admin/approved-students${qs ? `?${qs}` : ''}`);
  },

  async addApprovedStudent(payload: {
    email: string;
    divisionIds: string[];
  }): Promise<{ student: ApprovedStudent; report: ApprovedDatasetReport }> {
    return request('/api/admin/approved-students', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateApprovedStudent(
    email: string,
    payload: {
      divisionIds?: string[];
      status?: 'authorized' | 'revoked';
      newEmail?: string;
    }
  ): Promise<{ student: ApprovedStudent; report: ApprovedDatasetReport }> {
    return request(`/api/admin/approved-students/${encodeURIComponent(email)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
};
