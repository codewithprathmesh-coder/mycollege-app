import React, { useState, useEffect, useRef } from 'react';
import {
  MessageSquare,
  Search,
  Plus,
  Send,
  Paperclip,
  CheckCircle2,
  ShieldCheck,
  GraduationCap,
  Briefcase,
  Users,
  Pin,
  ExternalLink,
  ChevronLeft,
  Sparkles,
  Info,
  Clock,
  Code2,
  Calendar,
  X,
  FileText,
  Link,
  Copy,
  Check,
  Phone,
  Mail,
  UserPlus,
  Megaphone,
  AlertCircle,
  Share2,
  Trash2,
  QrCode,
  BookOpen,
  ArrowLeft,
  Download,
  Image as ImageIcon,
  BarChart2,
  Smile,
  CornerUpLeft,
  Lock,
  MoreVertical,
  CheckCheck,
  Shield,
  UserMinus,
  Settings,
  HelpCircle,
} from 'lucide-react';
import type {
  Announcement,
  ChannelType,
  ChatChannel,
  ChatMessage,
  ChannelMemberCandidate,
  CircleAnnouncement,
  Institution,
  PriorityLevel,
  User,
  UserRole,
  ChatPoll,
} from '../types';
import { api } from '../services/api';

interface ChatViewProps {
  currentUser: User;
  currentInstitution: Institution;
  announcements: Announcement[];
  onOpenAnnouncement: (announcement: Announcement) => void;
  onAnnouncementCreated?: (announcement: Announcement) => void;
  initialChannelId?: string;
  onOpenBatchDirectory?: () => void;
  onBack?: () => void;
  onConversationActiveChange?: (isActive: boolean, backFn: () => void) => void;
}

type CircleSubTab = 'chat' | 'announcements' | 'members';

interface RealtimeEvent {
  type: string;
  channelId?: string;
  channel?: ChatChannel;
  message?: ChatMessage;
  messageId?: string;
  userId?: string;
  user?: User;
  adminIds?: string[];
  reactions?: Record<string, string[]>;
  poll?: ChatPoll;
  isPinned?: boolean;
  memberCount?: number;
  announcement?: CircleAnnouncement;
}

const EMOJI_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥'];

export const ChatView: React.FC<ChatViewProps> = ({
  currentUser,
  currentInstitution,
  announcements,
  onOpenAnnouncement,
  onAnnouncementCreated,
  initialChannelId,
  onOpenBatchDirectory,
  onBack,
  onConversationActiveChange,
}) => {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<ChatChannel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [channelFilter, setChannelFilter] = useState<'all' | ChannelType>('all');
  const [channelSearch, setChannelSearch] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [newGroupType, setNewGroupType] = useState<ChannelType>('class');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupTitleInput, setGroupTitleInput] = useState('');
  const [groupDescInput, setGroupDescInput] = useState('');
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [isDeletingGroup, setIsDeletingGroup] = useState(false);

  // Attachment & Pin state
  const [attachment, setAttachment] = useState<{
    name: string;
    size: string;
    type: string;
    url?: string;
    previewUrl?: string;
  } | null>(null);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const [previewAttachmentModal, setPreviewAttachmentModal] = useState<{
    name: string;
    size: string;
    type: string;
    url?: string;
    previewUrl?: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // WhatsApp Quote / Reply state
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);

  // WhatsApp Message Search inside group
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [showGroupSearch, setShowGroupSearch] = useState(false);

  // WhatsApp Group Poll state
  const [showCreatePollModal, setShowCreatePollModal] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollAllowMultiple, setPollAllowMultiple] = useState(false);

  // WhatsApp Group Settings modal
  const [showGroupSettingsModal, setShowGroupSettingsModal] = useState(false);
  const [onlyAdminsMessage, setOnlyAdminsMessage] = useState(false);

  // Active view inside the circle: 'chat' | 'announcements' | 'members'
  const [activeCircleTab, setActiveCircleTab] = useState<CircleSubTab>('chat');

  // Circle Announcements state
  const [circleAnnouncements, setCircleAnnouncements] = useState<CircleAnnouncement[]>([]);
  const [showMakeAnnouncementModal, setShowMakeAnnouncementModal] = useState(false);
  const [annTitle, setAnnTitle] = useState('');
  const [annContent, setAnnContent] = useState('');
  const [annPriority, setAnnPriority] = useState<PriorityLevel>('normal');
  const [annDeadline, setAnnDeadline] = useState('');
  const [isPublishingAnn, setIsPublishingAnn] = useState(false);

  // Circle Members & Add Member Modal state
  const [members, setMembers] = useState<User[]>([]);
  const [circleAdminIds, setCircleAdminIds] = useState<string[]>([]);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);
  const [addMemberTab, setAddMemberTab] = useState<'search' | 'link'>('search');
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [allStudentsDirectory, setAllStudentsDirectory] = useState<ChannelMemberCandidate[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [studentDirectoryError, setStudentDirectoryError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Responsive mobile toggle (show sidebar or conversation)
  const [showMobileList, setShowMobileList] = useState(true);

  // Emoji picker popover for a message
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);

  // In-app toast feedback replacing window.alert/window.confirm
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' | 'info' } | null>(null);
  const showToast = (message: string, type: 'error' | 'success' | 'info' = 'error') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check if current user is admin of the selected circle
  const isCircleAdmin =
    Boolean(selectedChannel) &&
    (currentUser.role === 'admin' ||
      selectedChannel?.creatorId === currentUser.id ||
      (selectedChannel?.adminIds && selectedChannel.adminIds.includes(currentUser.id)) ||
      circleAdminIds.includes(currentUser.id));

  // Check if current user is an active member or authorized for this circle
  const isCircleMember =
    Boolean(selectedChannel) &&
    (currentUser.role === 'admin' ||
      selectedChannel?.creatorId === currentUser.id ||
      (selectedChannel?.adminIds && selectedChannel.adminIds.includes(currentUser.id)) ||
      (selectedChannel?.memberIds && selectedChannel.memberIds.includes(currentUser.id)) ||
      circleAdminIds.includes(currentUser.id) ||
      (selectedChannel?.type === 'class' && (
        (selectedChannel.divisionId && currentUser.divisionIds?.includes(selectedChannel.divisionId)) ||
        (currentUser.role === 'faculty' && (!selectedChannel.departmentId || currentUser.departmentId === selectedChannel.departmentId)) ||
        (!selectedChannel.divisionId && selectedChannel.departmentId === currentUser.departmentId)
      )));

  const canAddMembers =
    Boolean(selectedChannel) &&
    (isCircleAdmin ||
      (selectedChannel?.type === 'class' && currentUser.role === 'faculty' && (!selectedChannel.departmentId || currentUser.departmentId === selectedChannel.departmentId)));

  // Load channels on mount
  useEffect(() => {
    loadChannels();
  }, [currentInstitution.id]);

  const loadChannels = async () => {
    try {
      const res = await api.getChannels(currentInstitution.id);
      const availableChannels = res.channels || [];
      setChannels(availableChannels);
      setSelectedChannel((current) => {
        if (current) {
          return availableChannels.find((channel) => channel.id === current.id) ||
            availableChannels[0] ||
            null;
        }
        return (
          availableChannels.find((channel) => channel.id === initialChannelId) ||
          availableChannels[0] ||
          null
        );
      });
    } catch (err) {
      console.error('Failed to load channels:', err);
    }
  };

  // Load messages, members, announcements when channel changes
  useEffect(() => {
    if (!selectedChannel) {
      setMessages([]);
      setMembers([]);
      setCircleAnnouncements([]);
      return;
    }
    setMessages([]);
    setMembers([]);
    setCircleAnnouncements([]);
    loadMessages(selectedChannel.id);
    loadCircleMembers(selectedChannel.id);
    loadCircleAnnouncements(selectedChannel.id);
    setActiveCircleTab('chat');
    setOnlyAdminsMessage(Boolean(selectedChannel.onlyAdminsCanMessage));
    setReplyingTo(null);
    setGroupSearchQuery('');
    setShowGroupSearch(false);
  }, [selectedChannel?.id]);

  // Synchronize conversation state with parent back button navigation
  useEffect(() => {
    if (onConversationActiveChange) {
      onConversationActiveChange(Boolean(selectedChannel), handleBackToList);
    }
  }, [selectedChannel]);

  // Listen to browser / hardware back button inside ChatView
  useEffect(() => {
    const handleChannelPopState = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash.startsWith('circle-')) {
        const cId = hash.replace('circle-', '');
        const target = channels.find((c) => c.id === cId);
        if (target) {
          setSelectedChannel(target);
          setShowMobileList(false);
        }
      } else if (hash === 'chat' || hash === '' || hash === 'home') {
        setShowMobileList(true);
        setSelectedChannel(null);
      }
    };
    window.addEventListener('popstate', handleChannelPopState);
    return () => window.removeEventListener('popstate', handleChannelPopState);
  }, [channels]);

  const loadStudentsDirectory = async (channelId: string) => {
    try {
      setIsLoadingStudents(true);
      setStudentDirectoryError(null);
      setAllStudentsDirectory([]);
      const res = await api.getChannelMemberCandidates(channelId);
      const candidates = (res.candidates || []).map((c: any) => ({
        id: c.id || null,
        name:
          c.name ||
          c.full_name ||
          c.fullName ||
          (c.email ? c.email.split('@')[0].replace(/[._]/g, ' ') : 'Member'),
        email: (c.email || '').toLowerCase().trim(),
        role: c.role === 'teacher' ? 'faculty' : (c.role || 'student'),
        designation: c.designation || undefined,
        rollNo: c.rollNo || c.roll_no || undefined,
        membershipStatus: c.membershipStatus || c.membership_status || 'not_added',
      }));
      setAllStudentsDirectory(candidates);
    } catch (err) {
      console.error('Failed to load students directory:', err);
      setStudentDirectoryError(
        err instanceof Error ? err.message : 'Could not load the saved student and faculty directory.'
      );
    } finally {
      setIsLoadingStudents(false);
    }
  };

  const loadMessages = async (channelId: string) => {
    try {
      const res = await api.getMessages(channelId);
      setMessages(res.messages || []);
      scrollToBottom();
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  };

  const loadCircleMembers = async (channelId: string) => {
    try {
      const res = await api.getChannelMembers(channelId);
      setMembers(res.members || []);
      setCircleAdminIds(res.adminIds || []);
      setInviteCode(res.inviteCode || '');
      setInviteLink(res.inviteLink || `${window.location.origin}/circle/join/${channelId}`);
      if (res.onlyAdminsCanMessage !== undefined) {
        setOnlyAdminsMessage(res.onlyAdminsCanMessage);
      }
    } catch (err) {
      console.error('Failed to load members:', err);
    }
  };

  const loadCircleAnnouncements = async (channelId: string) => {
    try {
      const res = await api.getChannelAnnouncements(channelId);
      setCircleAnnouncements(res.announcements || []);
    } catch (err) {
      console.error('Failed to load circle announcements:', err);
    }
  };

  // The app-level authenticated socket dispatches events to active views.
  useEffect(() => {
    const handleRealtime = (event: Event) => {
      const data = (event as CustomEvent<RealtimeEvent>).detail;
      if (!data) return;

      if (data.type === 'connection:restored') {
        void loadChannels();
        if (selectedChannel) {
          void loadMessages(selectedChannel.id);
          void loadCircleMembers(selectedChannel.id);
          void loadCircleAnnouncements(selectedChannel.id);
        }
        return;
      }

      if (data.type === 'channels:changed') {
        void loadChannels();
        return;
      }

      if (data.type === 'channel:updated' && data.channel) {
        setChannels((previous) => previous.map((channel) =>
          channel.id === data.channel?.id ? data.channel : channel
        ));
        setSelectedChannel((previous) => previous?.id === data.channel?.id ? data.channel ?? previous : previous);
        return;
      }

      if (data.type === 'member:removed') {
        if (data.channelId !== selectedChannel?.id) return;
        if (data.userId === currentUser.id) {
          setSelectedChannel(null);
          setShowMobileList(true);
          void loadChannels();
          return;
        }
        setMembers((previous) => previous.filter((member) => member.id !== data.userId));
        if (data.memberCount !== undefined) {
          setSelectedChannel((previous) => previous ? { ...previous, memberCount: data.memberCount! } : null);
        }
        if (data.message) {
          setMessages((previous) => previous.some((message) => message.id === data.message?.id)
            ? previous
            : [...previous, data.message!]);
        }
        return;
      }

      if (data.type === 'announcement:new' && data.channelId === selectedChannel?.id) {
        if (data.announcement) {
          setCircleAnnouncements((previous) => previous.some((announcement) => announcement.id === data.announcement?.id)
            ? previous
            : [data.announcement!, ...previous]);
        }
        if (data.message) {
          setMessages((previous) => previous.some((message) => message.id === data.message?.id)
            ? previous
            : [...previous, data.message!]);
        }
        return;
      }

      if (data.channelId !== selectedChannel?.id) return;
      if (data.type === 'message:new' && data.message) {
        setMessages((previous) => previous.some((message) => message.id === data.message?.id)
          ? previous
          : [...previous, data.message!]);
        setChannels((previous) => previous.map((channel) => channel.id === data.channelId
          ? { ...channel, lastMessage: {
              senderName: data.message!.senderName,
              text: data.message!.content.slice(0, 80),
              timestamp: data.message!.timestamp,
            } }
          : channel));
        scrollToBottom();
      } else if (data.type === 'message:reaction' && data.messageId) {
        setMessages((previous) =>
          previous.map((message) => message.id === data.messageId ? { ...message, reactions: data.reactions } : message)
        );
      } else if (data.type === 'poll:updated' && data.messageId) {
        setMessages((previous) =>
          previous.map((message) => message.id === data.messageId ? { ...message, poll: data.poll } : message)
        );
      } else if (data.type === 'message:deleted' && data.messageId) {
        setMessages((previous) =>
          previous.map((message) => message.id === data.messageId
            ? { ...message, deleted: true, content: '🚫 This message was deleted', attachment: undefined, poll: undefined }
            : message)
        );
      } else if (data.type === 'message:pinned' && data.messageId) {
        setMessages((previous) =>
          previous.map((message) => message.id === data.messageId ? { ...message, isPinned: data.isPinned } : message)
        );
        setSelectedChannel((previous) =>
          previous ? { ...previous, pinnedMessageId: data.isPinned ? data.messageId : undefined } : null
        );
      } else if (data.type === 'member:added') {
        if (data.user) {
          setMembers((previous) => previous.some((member) => member.id === data.user?.id)
            ? previous
            : [...previous, data.user!]);
        }
        if (data.message) {
          setMessages((previous) => previous.some((message) => message.id === data.message?.id)
            ? previous
            : [...previous, data.message!]);
        }
        if (data.memberCount !== undefined) {
          setSelectedChannel((previous) => previous ? { ...previous, memberCount: data.memberCount! } : null);
        }
      } else if (data.type === 'admin:added' || data.type === 'admin:removed') {
        setCircleAdminIds(data.adminIds || []);
        if (data.message) {
          setMessages((previous) => previous.some((message) => message.id === data.message?.id)
            ? previous
            : [...previous, data.message!]);
        }
      };
    };
    window.addEventListener('mycollege:realtime', handleRealtime);
    return () => window.removeEventListener('mycollege:realtime', handleRealtime);
  }, [selectedChannel?.id, currentUser.id]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 80);
  };

  // Back button handler: if inside a channel, go back to channel list
  const handleBackToList = () => {
    setShowMobileList(true);
    setSelectedChannel(null);
    if (window.location.hash.startsWith('#circle-')) {
      window.history.pushState(
        { tab: 'chat', channelId: null },
        '',
        window.location.pathname + window.location.search + '#chat'
      );
    }
  };

  const handleSelectChannel = (chan: ChatChannel) => {
    setSelectedChannel(chan);
    setShowMobileList(false);
    window.history.pushState(
      { tab: 'chat', channelId: chan.id },
      '',
      window.location.pathname + window.location.search + `#circle-${chan.id}`
    );
  };

  const handleCreateGroup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (currentUser.role === 'student') {
      showToast('Students are not authorized to create groups.', 'error');
      return;
    }
    if (!newGroupTitle.trim()) return;

    try {
      setIsCreatingGroup(true);
      const response = await api.createChannel({
        name: newGroupTitle.trim(),
        title: newGroupTitle.trim(),
        description: newGroupDescription.trim(),
        type: newGroupType,
      });
      setChannels((previous) => [response.channel, ...previous.filter((channel) => channel.id !== response.channel.id)]);
      setSelectedChannel(response.channel);
      setChannelFilter(response.channel.type === 'project' ? 'interest' : response.channel.type);
      setShowMobileList(false);
      setShowCreateGroupModal(false);
      setNewGroupTitle('');
      setNewGroupDescription('');
      setNewGroupType('class');
      showToast('Group created successfully.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create group.', 'error');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  // 1. ADD MEMBERS HANDLERS (Completely Fixed & Verified)
  const handleOpenAddMemberModal = () => {
    if (!selectedChannel || !canAddMembers) {
      showToast('Only group administrators or faculty can add members.', 'error');
      return;
    }
    setStudentSearchQuery('');
    setShowAddMemberModal(true);
    void loadStudentsDirectory(selectedChannel.id);
  };

  const handleCloseAddMemberModal = () => {
    setStudentSearchQuery('');
    setShowAddMemberModal(false);
  };

  const handleAddMemberDirect = async (candidate: ChannelMemberCandidate) => {
    if (!selectedChannel || !canAddMembers) return;
    try {
      const response = await api.addMemberToChannel(selectedChannel.id, candidate.email);
      if (response.member) {
        setMembers((previous) => previous.some((member) => member.id === response.member.id)
          ? previous
          : [...previous, response.member as User]);
      }
      if (response.message) {
        setMessages((previous) => previous.some((m) => m.id === response.message!.id)
          ? previous
          : [...previous, response.message!]);
      }
      setSelectedChannel((previous) => (
        previous ? { ...previous, memberCount: response.memberCount } : null
      ));
      setAllStudentsDirectory((previous) => previous.map((entry) => (
        entry.email === candidate.email
          ? { ...entry, membershipStatus: response.pending ? 'pending' : 'active' }
          : entry
      )));
      setCopiedId(`added-${candidate.email}`);
      showToast(
        response.pending
          ? `Invitation saved for ${candidate.name}. They will join after signing in.`
          : `Added ${candidate.name} to #${selectedChannel.name}`,
        'success'
      );
      setTimeout(() => setCopiedId(null), 2500);
    } catch (err: any) {
      showToast(err.message || 'Failed to add this person to the group', 'error');
    }
  };

  // 2. FILE UPLOAD & PIN HANDLERS (Completely Fixed & Usable)
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formatSize = (bytes: number) => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const isImage = file.type.startsWith('image/');
    const url = URL.createObjectURL(file);

    setAttachment({
      name: file.name,
      size: formatSize(file.size),
      type: file.type || 'application/octet-stream',
      url,
      previewUrl: isImage ? url : undefined,
    });
    setShowAttachmentMenu(false);
    e.target.value = '';
  };

  const handleSelectPresetAttachment = (item: { name: string; size: string; type: string }) => {
    setAttachment(item);
    setShowAttachmentMenu(false);
  };

  // 3. SEND MESSAGE (With Text, Attachment, or Reply-To)
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedChannel || !isCircleMember) return;

    const content = messageInput.trim();
    if (!content && !attachment) return;

    try {
      setIsSending(true);

      const replyPayload = replyingTo
        ? {
            id: replyingTo.id,
            senderName: replyingTo.senderName,
            content: replyingTo.content,
            attachmentName: replyingTo.attachment?.name,
          }
        : undefined;

      const res = await api.sendMessage(
        selectedChannel.id,
        content || (attachment ? `Shared attachment: ${attachment.name}` : ''),
        attachment || undefined,
        replyPayload
      );

      setMessageInput('');
      setAttachment(null);
      setReplyingTo(null);

      setMessages((prev) => {
        if (prev.some((m) => m.id === res.message.id)) return prev;
        return [...prev, res.message];
      });

      setChannels((prev) =>
        prev.map((c) =>
          c.id === selectedChannel.id
            ? {
                ...c,
                lastMessage: {
                  senderName: currentUser.name,
                  text: content.slice(0, 80) || `📎 ${attachment?.name}`,
                  timestamp: res.message.timestamp,
                },
              }
            : c
        )
      );

      scrollToBottom();
    } catch (err: any) {
      showToast(err.message || 'Failed to send message', 'error');
    } finally {
      setIsSending(false);
    }
  };

  // 4. WHATSAPP REACTIONS HANDLER
  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!selectedChannel || !isCircleMember) return;
    try {
      // Optimistic update
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;
          const currentReactions = { ...(m.reactions || {}) };
          const usersForEmoji = currentReactions[emoji] || [];
          if (usersForEmoji.includes(currentUser.id)) {
            currentReactions[emoji] = usersForEmoji.filter((id) => id !== currentUser.id);
            if (currentReactions[emoji].length === 0) delete currentReactions[emoji];
          } else {
            currentReactions[emoji] = [...usersForEmoji, currentUser.id];
          }
          return { ...m, reactions: currentReactions };
        })
      );
      await api.toggleMessageReaction(selectedChannel.id, messageId, emoji);
    } catch (err) {
      console.error('Failed to react:', err);
    }
  };

  // 5. WHATSAPP PIN MESSAGE HANDLER
  const handleTogglePinMessage = async (message: ChatMessage) => {
    if (!selectedChannel || !isCircleAdmin) return;
    const newPinned = !message.isPinned;
    try {
      await api.pinMessage(selectedChannel.id, message.id, newPinned);
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, isPinned: newPinned } : m))
      );
      setSelectedChannel((prev) =>
        prev ? { ...prev, pinnedMessageId: newPinned ? message.id : undefined } : null
      );
      showToast(newPinned ? 'Message pinned to group header' : 'Message unpinned', 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to pin message', 'error');
    }
  };

  // 6. WHATSAPP DELETE MESSAGE HANDLER
  const handleDeleteMessage = async (messageId: string) => {
    if (!selectedChannel || !isCircleMember) return;
    try {
      await api.deleteMessage(selectedChannel.id, messageId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, deleted: true, content: '🚫 This message was deleted', attachment: undefined, poll: undefined }
            : m
        )
      );
      showToast('Message deleted for everyone', 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete message', 'error');
    }
  };

  // 7. WHATSAPP POLL CREATION & VOTING
  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChannel || !isCircleMember) return;
    const cleanQuestion = pollQuestion.trim();
    const validOptions = pollOptions.map((o) => o.trim()).filter(Boolean);

    if (!cleanQuestion || validOptions.length < 2) {
      showToast('Please enter a question and at least 2 options', 'error');
      return;
    }

    try {
      const res = await api.createPoll(selectedChannel.id, {
        question: cleanQuestion,
        options: validOptions,
        multipleAnswers: pollAllowMultiple,
      });

      setMessages((prev) => [...prev, res.message]);
      setShowCreatePollModal(false);
      setPollQuestion('');
      setPollOptions(['', '']);
      showToast('Poll created in chat', 'success');
      scrollToBottom();
    } catch (err: any) {
      showToast(err.message || 'Failed to create poll', 'error');
    }
  };

  const handleVotePoll = async (messageId: string, optionId: string) => {
    if (!selectedChannel || !isCircleMember) return;
    try {
      const res = await api.votePoll(selectedChannel.id, messageId, optionId);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, poll: res.poll } : m))
      );
    } catch (err: any) {
      showToast(err.message || 'Failed to cast vote', 'error');
    }
  };

  // 8. MAKE GROUP ADMIN & DISMISS ADMIN
  const handleMakeAdmin = async (userId: string) => {
    if (!selectedChannel || !isCircleAdmin) return;
    try {
      const res = await api.makeGroupAdmin(selectedChannel.id, userId);
      setCircleAdminIds(res.adminIds);
      setSelectedChannel((prev) => (prev ? { ...prev, adminIds: res.adminIds } : null));
      showToast('Participant appointed as Group Admin', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to make group admin', 'error');
    }
  };

  const handleDismissAdmin = async (userId: string) => {
    if (!selectedChannel || !isCircleAdmin) return;
    try {
      const res = await api.dismissGroupAdmin(selectedChannel.id, userId);
      setCircleAdminIds(res.adminIds);
      setSelectedChannel((prev) => (prev ? { ...prev, adminIds: res.adminIds } : null));
      showToast('Admin dismissed to regular participant', 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to dismiss admin', 'error');
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedChannel || !isCircleAdmin) return;
    try {
      await api.removeMemberFromChannel(selectedChannel.id, userId);
      setMembers((prev) => prev.filter((m) => m.id !== userId));
      setSelectedChannel((prev) => (prev ? { ...prev, memberCount: Math.max(1, prev.memberCount - 1) } : null));
      showToast('Participant removed from group', 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to remove member', 'error');
    }
  };

  // 9. GROUP SETTINGS & DELETION (Admins only)
  const handleOpenGroupSettings = () => {
    if (!selectedChannel) return;
    setGroupTitleInput(selectedChannel.title);
    setGroupDescInput(selectedChannel.description || '');
    setOnlyAdminsMessage(Boolean(selectedChannel.onlyAdminsCanMessage));
    setShowGroupSettingsModal(true);
  };

  const handleSaveGroupSettings = async () => {
    if (!selectedChannel || !isCircleAdmin) return;
    try {
      const res = await api.updateGroupSettings(selectedChannel.id, {
        title: groupTitleInput.trim() || selectedChannel.title,
        description: groupDescInput.trim(),
        onlyAdminsCanMessage: onlyAdminsMessage,
      });
      setSelectedChannel(res.channel);
      setChannels((prev) => prev.map((c) => (c.id === res.channel.id ? res.channel : c)));
      setShowGroupSettingsModal(false);
      showToast('Group settings updated successfully', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to update group settings', 'error');
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedChannel || !isCircleAdmin) return;
    try {
      setIsDeletingGroup(true);
      const targetId = selectedChannel.id;
      await api.deleteChannel(targetId);
      setChannels((prev) => prev.filter((c) => c.id !== targetId));
      setSelectedChannel(null);
      setShowDeleteConfirmModal(false);
      setShowGroupSettingsModal(false);
      showToast('Group deleted successfully.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete group', 'error');
    } finally {
      setIsDeletingGroup(false);
    }
  };

  // 10. PUBLISH CIRCLE ANNOUNCEMENT
  const handlePublishCircleAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChannel || !annTitle.trim() || !annContent.trim()) return;

    try {
      setIsPublishingAnn(true);
      const res = await api.createChannelAnnouncement(selectedChannel.id, {
        title: annTitle.trim(),
        content: annContent.trim(),
        priority: annPriority,
        deadline: annDeadline || undefined,
      });

      setCircleAnnouncements((prev) => prev.some((announcement) => announcement.id === res.circleAnnouncement.id)
        ? prev
        : [res.circleAnnouncement, ...prev]);
      setShowMakeAnnouncementModal(false);
      setAnnTitle('');
      setAnnContent('');
      setAnnDeadline('');

      if (onAnnouncementCreated && res.campusAnnouncement) {
        onAnnouncementCreated(res.campusAnnouncement);
      }

      showToast('Announcement broadcasted to group & campus feed', 'success');
      loadMessages(selectedChannel.id);
      setActiveCircleTab('announcements');
    } catch (err: any) {
      showToast(err.message || 'Failed to broadcast announcement', 'error');
    } finally {
      setIsPublishingAnn(false);
    }
  };

  const copyToClipboard = async (text: string, id: string = 'main') => {
    try {
      await navigator.clipboard.writeText(text);
      if (id === 'main') {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch {
      // fallback
    }
  };

  // Pinned message finder
  const pinnedMessage = messages.find((m) => m.isPinned);

  // Filter messages by group search query if active
  const displayedMessages = messages.filter((m) => {
    if (!groupSearchQuery.trim()) return true;
    const q = groupSearchQuery.toLowerCase();
    return (
      m.content.toLowerCase().includes(q) ||
      m.senderName.toLowerCase().includes(q) ||
      (m.attachment && m.attachment.name.toLowerCase().includes(q))
    );
  });

  // Filter channels in sidebar - only authorized active members can see groups
  const filteredChannels = channels.filter((c) => {
    const hasAccess =
      currentUser.role === 'admin' ||
      c.creatorId === currentUser.id ||
      (c.adminIds && c.adminIds.includes(currentUser.id)) ||
      (c.memberIds && c.memberIds.includes(currentUser.id)) ||
      (c.type === 'class' && (
        (c.divisionId && currentUser.divisionIds?.includes(c.divisionId)) ||
        (currentUser.role === 'faculty' && (!c.departmentId || currentUser.departmentId === c.departmentId)) ||
        (!c.divisionId && c.departmentId && currentUser.departmentId === c.departmentId)
      ));
    if (!hasAccess) return false;

    const matchesFilter =
      channelFilter === 'all' ||
      (channelFilter === 'class' && c.type === 'class') ||
      (channelFilter === 'interest' && (c.type === 'interest' || c.type === 'project')) ||
      (channelFilter === 'club' && c.type === 'club');
    const matchesSearch =
      !channelSearch.trim() ||
      c.title.toLowerCase().includes(channelSearch.toLowerCase()) ||
      c.name.toLowerCase().includes(channelSearch.toLowerCase()) ||
      c.description.toLowerCase().includes(channelSearch.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const formatMsgTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6 py-4">
      {/* Hidden Native File & Image Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        className="hidden"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"
      />
      <input
        type="file"
        ref={imageInputRef}
        onChange={handleFileInputChange}
        className="hidden"
        accept="image/*"
      />

      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex h-[82vh] relative">
        {/* ========================================================================= */}
        {/* LEFT COLUMN: CHAT LIST (WhatsApp Sidebar) */}
        {/* ========================================================================= */}
        <div
          className={`${
            showMobileList ? 'flex' : 'hidden'
          } md:flex flex-col w-full md:w-80 lg:w-96 border-r border-slate-200 bg-white shrink-0`}
        >
          {/* Header & Back to Dashboard */}
          <div className="p-3.5 border-b border-slate-200 bg-slate-50/70 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {onBack && (
                  <button
                    type="button"
                    onClick={onBack}
                    className="p-1.5 -ml-1 text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 rounded-xl transition-colors cursor-pointer"
                    title="Back to Dashboard"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="font-bold text-sm text-slate-900 leading-none">Chats & Groups</h2>
                    <span className="text-[11px] text-slate-500 font-medium">
                      {channels.length} circles available
                    </span>
                  </div>
                </div>
              </div>

              {/* Verified Domain Badge */}
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                @{currentInstitution.shortName}
              </span>
            </div>

            {currentUser.role !== 'student' && (
              <button
                type="button"
                onClick={() => setShowCreateGroupModal(true)}
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Group
              </button>
            )}

            {/* Search channels input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                placeholder="Search groups or classmates..."
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 focus:border-blue-500 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 outline-none transition-all"
              />
              {channelSearch && (
                <button
                  type="button"
                  onClick={() => setChannelSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter pills */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar text-xs">
              {[
                { id: 'all', label: 'All' },
                { id: 'class', label: 'Academic & Class' },
                { id: 'interest', label: 'Tech & AI' },
                { id: 'club', label: 'Clubs & Sports' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setChannelFilter(t.id as any)}
                  className={`px-2.5 py-1 rounded-lg font-medium whitespace-nowrap transition-colors cursor-pointer text-[11px] ${
                    channelFilter === t.id
                      ? 'bg-blue-600 text-white font-semibold shadow-2xs'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Channels List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredChannels.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 space-y-2.5">
                <Users className="w-6 h-6 mx-auto opacity-30" />
                <p>No groups found matching filter.</p>
                {currentUser.role !== 'student' && (
                  <button
                    type="button"
                    onClick={() => setShowCreateGroupModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold rounded-lg text-xs transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Create a Group
                  </button>
                )}
              </div>
            ) : (
              filteredChannels.map((chan) => {
                const isSelected = selectedChannel?.id === chan.id;
                return (
                  <div
                    key={chan.id}
                    onClick={() => handleSelectChannel(chan)}
                    className={`p-3 cursor-pointer transition-colors flex items-start gap-3 ${
                      isSelected
                        ? 'bg-blue-50/80 border-l-4 border-l-blue-600 text-slate-900'
                        : 'hover:bg-slate-50 text-slate-700'
                    }`}
                  >
                    {/* Channel Avatar */}
                    <div
                      className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs ${
                        chan.isOfficial
                          ? 'bg-blue-600 text-white'
                          : chan.type === 'club'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-indigo-600 text-white'
                      }`}
                    >
                      {chan.title.slice(0, 2).toUpperCase()}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-bold text-xs sm:text-sm text-slate-900 truncate">
                            {chan.title}
                          </span>
                          {chan.isOfficial && (
                            <span title="Verified College Group" className="shrink-0">
                              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                            </span>
                          )}
                        </div>
                        {chan.lastMessage && (
                          <span className="text-[10px] text-slate-400 font-mono shrink-0">
                            {formatMsgTime(chan.lastMessage.timestamp)}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-1 mt-0.5">
                        <p className="text-xs text-slate-500 truncate">
                          {chan.lastMessage ? (
                            <span>
                              <span className="font-semibold text-slate-700">
                                {chan.lastMessage.senderName.split(' ')[0]}:{' '}
                              </span>
                              {chan.lastMessage.text}
                            </span>
                          ) : (
                            chan.description
                          )}
                        </p>

                        {chan.unreadCount && chan.unreadCount > 0 ? (
                          <span className="px-1.5 py-0.2 rounded-full bg-blue-600 text-white text-[10px] font-bold font-mono shrink-0">
                            {chan.unreadCount}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* RIGHT COLUMN: ACTIVE GROUP CONVERSATION */}
        {/* ========================================================================= */}
        <div
          className={`${
            !showMobileList ? 'flex' : 'hidden'
          } md:flex flex-col flex-1 bg-slate-50/40 relative min-w-0`}
        >
          {selectedChannel ? (
            <>
              {/* Channel Top Bar */}
              <div className="px-4 py-3 border-b border-slate-200 bg-white space-y-2 shrink-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={handleBackToList}
                      className="p-1.5 text-slate-600 hover:text-blue-700 hover:bg-slate-100 rounded-xl flex items-center gap-1 text-xs font-semibold cursor-pointer border border-slate-200 transition-colors md:hidden"
                      title="Return to Groups list"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Chats</span>
                    </button>

                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-700 to-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                      {selectedChannel.title.slice(0, 2).toUpperCase()}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-sm sm:text-base text-slate-900 truncate">
                          {selectedChannel.title}
                        </h3>
                        {selectedChannel.isOfficial && (
                          <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.2">
                            <ShieldCheck className="w-3 h-3 text-blue-600" />
                            Official Group
                          </span>
                        )}
                        {selectedChannel.onlyAdminsCanMessage && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.2">
                            <Lock className="w-3 h-3 text-amber-600" />
                            Admins Only
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 flex items-center gap-2 truncate">
                        <span>{selectedChannel.memberCount} participants</span>
                        <span>·</span>
                        <span className="truncate">{selectedChannel.description}</span>
                      </div>
                    </div>
                  </div>

                  {/* Top Bar Actions: Search, Add Members, Group Settings */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Search inside group button */}
                    <button
                      type="button"
                      onClick={() => setShowGroupSearch((prev) => !prev)}
                      className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                        showGroupSearch
                          ? 'bg-blue-50 border-blue-300 text-blue-700'
                          : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-600'
                      }`}
                      title="Search in this chat"
                    >
                      <Search className="w-4 h-4" />
                    </button>

                    {/* ADD MEMBERS BUTTON (100% Usable & Functional) */}
                    {canAddMembers && (
                      <button
                        type="button"
                        onClick={handleOpenAddMemberModal}
                        className="px-2.5 sm:px-3 py-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer shrink-0"
                        title="Add students or faculty to this group"
                      >
                        <UserPlus className="w-3.5 h-3.5 shrink-0" />
                        <span className="inline font-semibold">Add Members</span>
                      </button>
                    )}

                    {/* Group Settings & Delete Buttons (Group Admins & App Admins) */}
                    {isCircleAdmin && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={handleOpenGroupSettings}
                          className="p-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-xl transition-colors cursor-pointer"
                          title="Group Settings & Admin Permissions"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowDeleteConfirmModal(true)}
                          className="p-2 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-300 text-slate-500 hover:text-rose-600 rounded-xl transition-colors cursor-pointer"
                          title="Delete Group"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Search Bar inside Group (Collapsible) */}
                {showGroupSearch && (
                  <div className="p-2 bg-slate-50 rounded-2xl border border-slate-200 flex items-center gap-2 animate-in fade-in duration-150">
                    <Search className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
                    <input
                      type="text"
                      value={groupSearchQuery}
                      onChange={(e) => setGroupSearchQuery(e.target.value)}
                      placeholder="Search messages, files, or classmate names in this group..."
                      className="w-full bg-transparent text-xs text-slate-900 outline-none"
                      autoFocus
                    />
                    {groupSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setGroupSearchQuery('')}
                        className="text-slate-400 hover:text-slate-600 p-1 text-xs"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Sub-Tabs: ONLY Chat Stream | Official Announcements | Group Members (Batch Directory removed as required by Section 7!) */}
                <div className="flex items-center gap-1 pt-1 border-t border-slate-100 text-xs">
                  <button
                    type="button"
                    onClick={() => setActiveCircleTab('chat')}
                    className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                      activeCircleTab === 'chat'
                        ? 'bg-blue-50 text-blue-700 font-bold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Chat Stream</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveCircleTab('announcements')}
                    className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                      activeCircleTab === 'announcements'
                        ? 'bg-blue-50 text-blue-700 font-bold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <Megaphone className="w-3.5 h-3.5" />
                    <span>Official Announcements</span>
                    {circleAnnouncements.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-200 text-blue-800 font-bold font-mono">
                        {circleAnnouncements.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveCircleTab('members')}
                    className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                      activeCircleTab === 'members'
                        ? 'bg-blue-50 text-blue-700 font-bold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Group Members & Admins ({members.length})</span>
                  </button>
                </div>
              </div>

              {/* =================================================================== */}
              {/* SUB-TAB 1: CHAT STREAM */}
              {/* =================================================================== */}
              {activeCircleTab === 'chat' && (
                <>
                  {/* WhatsApp Pinned Message Banner */}
                  {pinnedMessage && (
                    <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between text-xs text-amber-900">
                      <div className="flex items-center gap-2 truncate">
                        <Pin className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                        <span className="font-bold truncate">
                          Pinned: {pinnedMessage.senderName}:{' '}
                        </span>
                        <span className="truncate">{pinnedMessage.content}</span>
                      </div>
                      {isCircleAdmin && (
                        <button
                          type="button"
                          onClick={() => handleTogglePinMessage(pinnedMessage)}
                          className="text-[11px] font-semibold text-amber-800 hover:underline shrink-0 ml-2 cursor-pointer"
                        >
                          Unpin
                        </button>
                      )}
                    </div>
                  )}

                  {/* Messages Stream */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {displayedMessages.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400 space-y-1">
                        <MessageSquare className="w-8 h-8 mx-auto opacity-30 text-blue-600" />
                        <p className="font-semibold text-slate-700">No messages found</p>
                        <p className="text-slate-400">
                          {groupSearchQuery
                            ? `No messages matched "${groupSearchQuery}".`
                            : 'Start the conversation in this group!'}
                        </p>
                      </div>
                    ) : (
                      displayedMessages.map((msg) => {
                        const isSystem =
                          msg.senderId === 'system' ||
                          msg.senderName === 'Campus Bot' ||
                          msg.senderName === 'Group System' ||
                          msg.senderName === 'Group Security' ||
                          (msg.senderRole as string) === 'system' ||
                          (msg.content && (
                            msg.content.includes(' was added ') ||
                            msg.content.includes(' added ') ||
                            msg.content.includes(' joined #') ||
                            msg.content.includes(' left the group')
                          ));
                        const isSelf = !isSystem && msg.senderId === currentUser.id;
                        const isFaculty = msg.senderRole === 'faculty' || msg.senderRole === 'admin';

                        if (isSystem) {
                          return (
                            <div key={msg.id} className="flex justify-center my-3">
                              <span className="text-[11px] font-medium text-slate-700 bg-slate-200/90 backdrop-blur-xs px-3.5 py-1.5 rounded-full text-center shadow-2xs border border-slate-300/40 max-w-md">
                                {msg.content}
                              </span>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={msg.id}
                            onMouseEnter={() => setHoveredMessageId(msg.id)}
                            onMouseLeave={() => setHoveredMessageId(null)}
                            className={`flex gap-2.5 text-xs sm:text-sm group relative ${
                              isSelf ? 'flex-row-reverse' : ''
                            }`}
                          >
                            {/* Avatar */}
                            <div
                              className={`w-8 h-8 rounded-2xl flex items-center justify-center text-xs font-bold shrink-0 shadow-2xs ${
                                isFaculty
                                  ? 'bg-blue-600 text-white'
                                  : isSelf
                                  ? 'bg-slate-900 text-white'
                                  : 'bg-indigo-100 text-indigo-800'
                              }`}
                            >
                              {msg.senderName.slice(0, 2).toUpperCase()}
                            </div>

                            {/* Message Container */}
                            <div className={`max-w-[85%] sm:max-w-xl space-y-1 ${isSelf ? 'items-end' : ''}`}>
                              {/* Sender Meta */}
                              <div
                                className={`flex items-center gap-1.5 text-xs ${
                                  isSelf ? 'justify-end' : ''
                                }`}
                              >
                                <span className="font-bold text-slate-900 text-[11px]">
                                  {msg.senderName}
                                </span>
                                {circleAdminIds.includes(msg.senderId) && (
                                  <span className="text-[9px] font-bold font-mono px-1 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                                    Admin
                                  </span>
                                )}
                                <span className="text-[10px] text-slate-400 font-mono">
                                  {formatMsgTime(msg.timestamp)}
                                </span>
                              </div>

                              {/* Message Bubble */}
                              <div
                                className={`p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed relative ${
                                  msg.deleted
                                    ? 'bg-slate-100 text-slate-500 italic border border-slate-200'
                                    : isFaculty
                                    ? 'bg-blue-50 border border-blue-200 text-blue-950 font-normal shadow-2xs'
                                    : isSelf
                                    ? 'bg-blue-600 text-white rounded-tr-xs shadow-2xs'
                                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-xs shadow-2xs'
                                }`}
                              >
                                {/* WhatsApp Quote / Reply Preview in Bubble */}
                                {msg.replyTo && (
                                  <div
                                    className={`mb-2 p-2 rounded-xl text-[11px] border-l-4 ${
                                      isSelf
                                        ? 'bg-blue-700/80 border-l-white text-blue-100'
                                        : 'bg-slate-100 border-l-blue-600 text-slate-700'
                                    }`}
                                  >
                                    <div className="font-bold">{msg.replyTo.senderName}</div>
                                    <div className="truncate opacity-90">
                                      {msg.replyTo.attachmentName
                                        ? `📎 ${msg.replyTo.attachmentName}`
                                        : msg.replyTo.content}
                                    </div>
                                  </div>
                                )}

                                {/* Message Text */}
                                <div className="whitespace-pre-line">{msg.content}</div>

                                {/* Attachment Card if present */}
                                {msg.attachment && (
                                  <div
                                    onClick={() => setPreviewAttachmentModal(msg.attachment!)}
                                    className={`mt-2.5 p-2.5 rounded-xl flex items-center gap-2.5 text-xs border cursor-pointer transition-all ${
                                      isSelf
                                        ? 'bg-blue-700/80 border-blue-500 text-white hover:bg-blue-700'
                                        : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100'
                                    }`}
                                    title="Click to preview or download"
                                  >
                                    {msg.attachment.previewUrl ? (
                                      <img
                                        src={msg.attachment.previewUrl}
                                        alt={msg.attachment.name}
                                        className="w-10 h-10 rounded-lg object-cover border border-white/20 shrink-0"
                                      />
                                    ) : (
                                      <div
                                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                                          isSelf ? 'bg-blue-800 text-white' : 'bg-blue-100 text-blue-700'
                                        }`}
                                      >
                                        <FileText className="w-4 h-4" />
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <span className="font-bold truncate block">{msg.attachment.name}</span>
                                      <span
                                        className={`font-mono text-[10px] block ${
                                          isSelf ? 'text-blue-200' : 'text-slate-500'
                                        }`}
                                      >
                                        {msg.attachment.size} · Tap to preview / download
                                      </span>
                                    </div>
                                    <Download className="w-4 h-4 shrink-0 opacity-80" />
                                  </div>
                                )}

                                {/* WhatsApp Interactive Poll Card */}
                                {msg.poll && (
                                  <div className="mt-3 p-3.5 bg-white rounded-2xl border border-slate-200 text-slate-900 space-y-2.5 shadow-2xs">
                                    <div className="flex items-center gap-2 text-xs font-bold text-blue-700">
                                      <BarChart2 className="w-4 h-4 text-blue-600" />
                                      <span>Group Poll</span>
                                    </div>
                                    <h5 className="font-bold text-xs sm:text-sm text-slate-900">
                                      {msg.poll.question}
                                    </h5>
                                    <div className="space-y-2 pt-1">
                                      {msg.poll.options.map((opt) => {
                                        const hasVoted = opt.votes.includes(currentUser.id);
                                        const totalVotes =
                                          msg.poll?.options.reduce((sum, o) => sum + o.votes.length, 0) || 0;
                                        const pct =
                                          totalVotes > 0
                                            ? Math.round((opt.votes.length / totalVotes) * 100)
                                            : 0;

                                        return (
                                          <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => handleVotePoll(msg.id, opt.id)}
                                            className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                                              hasVoted
                                                ? 'bg-blue-50/90 border-blue-400 font-semibold text-blue-900'
                                                : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                                            }`}
                                          >
                                            {/* Percentage progress bar fill */}
                                            <div
                                              className="absolute left-0 top-0 bottom-0 bg-blue-200/50 transition-all duration-300"
                                              style={{ width: `${pct}%` }}
                                            />
                                            <div className="relative z-10 flex items-center justify-between text-xs">
                                              <span className="flex items-center gap-2 truncate">
                                                <span
                                                  className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                                    hasVoted
                                                      ? 'border-blue-600 bg-blue-600 text-white'
                                                      : 'border-slate-300'
                                                  }`}
                                                >
                                                  {hasVoted && <Check className="w-2.5 h-2.5" />}
                                                </span>
                                                <span className="truncate">{opt.text}</span>
                                              </span>
                                              <span className="font-mono text-[11px] font-bold shrink-0 ml-2">
                                                {pct}% ({opt.votes.length})
                                              </span>
                                            </div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* WhatsApp Message Delivery checkmarks */}
                                {isSelf && (
                                  <div className="flex justify-end pt-1">
                                    <span title="Delivered to group">
                                      <CheckCheck className="w-3.5 h-3.5 text-blue-200" />
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* WhatsApp Emoji Reactions Badges */}
                              {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                                <div
                                  className={`flex flex-wrap gap-1 pt-1 ${
                                    isSelf ? 'justify-end' : ''
                                  }`}
                                >
                                  {Object.entries(msg.reactions).map(([emoji, uids]) => {
                                    const hasReacted = uids.includes(currentUser.id);
                                    return (
                                      <button
                                        key={emoji}
                                        type="button"
                                        onClick={() => handleToggleReaction(msg.id, emoji)}
                                        className={`px-2 py-0.5 rounded-full text-xs flex items-center gap-1 border transition-all cursor-pointer ${
                                          hasReacted
                                            ? 'bg-blue-100 border-blue-300 font-bold'
                                            : 'bg-white border-slate-200 hover:bg-slate-100'
                                        }`}
                                      >
                                        <span>{emoji}</span>
                                        <span className="font-mono text-[10px] text-slate-600 font-semibold">
                                          {uids.length}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Hover Quick Action Bar (Reply, React, Pin, Delete) */}
                            {hoveredMessageId === msg.id && !msg.deleted && (
                              <div
                                className={`absolute top-0 flex items-center gap-1 bg-white border border-slate-200 shadow-md rounded-xl p-1 z-20 ${
                                  isSelf ? 'left-4' : 'right-4'
                                }`}
                              >
                                {/* Quick Reacts */}
                                {['👍', '❤️', '😂', '🔥'].map((emoji) => (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => handleToggleReaction(msg.id, emoji)}
                                    className="p-1 hover:bg-slate-100 rounded-lg text-xs cursor-pointer"
                                  >
                                    {emoji}
                                  </button>
                                ))}

                                {/* Reply Button */}
                                <button
                                  type="button"
                                  onClick={() => setReplyingTo(msg)}
                                  className="p-1 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer"
                                  title="Reply / Quote"
                                >
                                  <CornerUpLeft className="w-3.5 h-3.5" />
                                </button>

                                {/* Pin Button (Admins only) */}
                                {isCircleAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => handleTogglePinMessage(msg)}
                                    className={`p-1 rounded-lg cursor-pointer ${
                                      msg.isPinned
                                        ? 'text-amber-600 bg-amber-50'
                                        : 'text-slate-500 hover:text-amber-600 hover:bg-amber-50'
                                    }`}
                                    title={msg.isPinned ? 'Unpin message' : 'Pin to top'}
                                  >
                                    <Pin className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                {/* Delete Button */}
                                {(msg.senderId === currentUser.id || isCircleAdmin) && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteMessage(msg.id)}
                                    className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                                    title="Delete message"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  {/* =================================================================== */}
                  {/* MESSAGE COMPOSER / INPUT SECTION */}
                  {/* =================================================================== */}
                  <div className="p-3 sm:p-4 border-t border-slate-200 bg-white space-y-2 shrink-0 relative">
                    {/* Non-Member Access Lock Banner */}
                    {!isCircleMember ? (
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center gap-2 text-xs font-semibold text-slate-600 text-center">
                        <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                        <span>You are not a member of this circle. Only invited members can send messages.</span>
                      </div>
                    ) : selectedChannel.onlyAdminsCanMessage && !isCircleAdmin ? (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center gap-2 text-xs font-semibold text-amber-900">
                        <Lock className="w-4 h-4 text-amber-600" />
                        <span>Only group administrators can send messages to this circle.</span>
                      </div>
                    ) : (
                      <>
                        {/* WhatsApp Replying Banner if active */}
                        {replyingTo && (
                          <div className="flex items-center justify-between p-2 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-900">
                            <div className="flex items-center gap-2 truncate">
                              <CornerUpLeft className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              <span className="font-bold">Replying to {replyingTo.senderName}:</span>
                              <span className="truncate opacity-80">
                                {replyingTo.attachment?.name
                                  ? `📎 ${replyingTo.attachment.name}`
                                  : replyingTo.content}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setReplyingTo(null)}
                              className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {/* Attached file banner */}
                        {attachment && (
                          <div className="flex items-center justify-between text-xs text-blue-800 bg-blue-50/90 border border-blue-200 rounded-2xl px-3 py-2 shadow-2xs">
                            <div className="flex items-center gap-2.5 truncate">
                              {attachment.previewUrl ? (
                                <img
                                  src={attachment.previewUrl}
                                  alt="Preview"
                                  className="w-9 h-9 rounded-lg object-cover border border-blue-200 shrink-0"
                                />
                              ) : (
                                <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                                  <FileText className="w-4 h-4" />
                                </div>
                              )}
                              <div className="truncate">
                                <span className="font-bold block truncate">{attachment.name}</span>
                                <span className="text-[10px] text-slate-500 font-mono block">
                                  {attachment.size} · Ready to send
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setAttachment(null)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                              title="Remove attachment"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        )}

                        {/* Input Row with The Pin / Paperclip Button */}
                        <form onSubmit={handleSendMessage} className="flex items-center gap-2 relative">
                          {/* Real hidden file inputs triggered by the Pin & Attachment Menu */}
                          <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileInputChange}
                            className="hidden"
                            tabIndex={-1}
                            aria-hidden="true"
                          />
                          <input
                            type="file"
                            ref={imageInputRef}
                            accept="image/*"
                            onChange={handleFileInputChange}
                            className="hidden"
                            tabIndex={-1}
                            aria-hidden="true"
                          />

                          {/* THE PIN BUTTON: 100% Clickable WhatsApp Attachment Menu */}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setShowAttachmentMenu((prev) => !prev)}
                              className={`p-2.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-center shadow-2xs ${
                                showAttachmentMenu || attachment
                                  ? 'bg-blue-600 text-white border-blue-600 ring-2 ring-blue-200'
                                  : 'text-slate-600 hover:text-blue-600 hover:bg-blue-50 border-slate-200 bg-white'
                              }`}
                              title="Attach file, photo, notes, or create poll"
                              aria-label="Attach File or Poll"
                            >
                              <Paperclip className="w-4 h-4" />
                            </button>

                            {/* WhatsApp Style Attachment Drawer */}
                            {showAttachmentMenu && (
                              <div className="absolute bottom-12 left-0 w-72 sm:w-80 bg-white rounded-3xl shadow-2xl border border-slate-200 p-4 z-50 animate-in fade-in zoom-in-95 duration-150">
                                <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
                                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                    <Paperclip className="w-3.5 h-3.5 text-blue-600" />
                                    <span>Share in #{selectedChannel.name}</span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setShowAttachmentMenu(false)}
                                    className="text-slate-400 hover:text-slate-600 p-1"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                <div className="grid grid-cols-2 gap-2 mb-3">
                                  {/* 1. Document */}
                                  <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="p-3 rounded-2xl bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 transition-all text-left flex flex-col items-center justify-center gap-1.5 group cursor-pointer"
                                  >
                                    <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                      <FileText className="w-4 h-4" />
                                    </div>
                                    <span className="text-xs font-bold text-slate-800">Document</span>
                                    <span className="text-[10px] text-slate-400 font-mono">PDF, Word, Zip</span>
                                  </button>

                                  {/* 2. Photo / Image */}
                                  <button
                                    type="button"
                                    onClick={() => imageInputRef.current?.click()}
                                    className="p-3 rounded-2xl bg-slate-50 hover:bg-purple-50 border border-slate-200 hover:border-purple-300 transition-all text-left flex flex-col items-center justify-center gap-1.5 group cursor-pointer"
                                  >
                                    <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition-colors">
                                      <ImageIcon className="w-4 h-4" />
                                    </div>
                                    <span className="text-xs font-bold text-slate-800">Photos</span>
                                    <span className="text-[10px] text-slate-400 font-mono">PNG, JPG, WebP</span>
                                  </button>

                                  {/* 3. WhatsApp Group Poll */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowAttachmentMenu(false);
                                      setShowCreatePollModal(true);
                                    }}
                                    className="p-3 rounded-2xl bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-300 transition-all text-left flex flex-col items-center justify-center gap-1.5 group cursor-pointer"
                                  >
                                    <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-colors">
                                      <BarChart2 className="w-4 h-4" />
                                    </div>
                                    <span className="text-xs font-bold text-slate-800">Poll</span>
                                    <span className="text-[10px] text-slate-400 font-mono">Vote in group</span>
                                  </button>

                                  {/* 4. Official Notice Broadcast (Faculty/Admin) or Invite (if authorized) */}
                                  {isCircleAdmin ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowAttachmentMenu(false);
                                        setShowMakeAnnouncementModal(true);
                                      }}
                                      className="p-3 rounded-2xl bg-slate-50 hover:bg-rose-50 border border-slate-200 hover:border-rose-300 transition-all text-left flex flex-col items-center justify-center gap-1.5 group cursor-pointer"
                                    >
                                      <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center group-hover:bg-rose-600 group-hover:text-white transition-colors">
                                        <Megaphone className="w-4 h-4" />
                                      </div>
                                      <span className="text-xs font-bold text-slate-800">Notice</span>
                                      <span className="text-[10px] text-slate-400 font-mono">Official Circular</span>
                                    </button>
                                  ) : canAddMembers ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowAttachmentMenu(false);
                                        handleOpenAddMemberModal();
                                      }}
                                      className="p-3 rounded-2xl bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 transition-all text-left flex flex-col items-center justify-center gap-1.5 group cursor-pointer"
                                    >
                                      <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                                        <UserPlus className="w-4 h-4" />
                                      </div>
                                      <span className="text-xs font-bold text-slate-800">Invite</span>
                                      <span className="text-[10px] text-slate-400 font-mono">Add members</span>
                                    </button>
                                  ) : null}
                                </div>

                                {/* Academic Notes Presets */}
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pb-1">
                                  Quick Academic Notes
                                </div>
                                <div className="space-y-1">
                                  {[
                                    { name: 'Unit-3_DeepLearning_Notes.pdf', size: '1.8 MB', type: 'application/pdf' },
                                    { name: 'Lab_Exp_4_Data_Structures.pdf', size: '840 KB', type: 'application/pdf' },
                                    { name: 'Semester_VI_Internal_Timetable.pdf', size: '320 KB', type: 'application/pdf' },
                                  ].map((preset) => (
                                    <button
                                      key={preset.name}
                                      type="button"
                                      onClick={() => handleSelectPresetAttachment(preset)}
                                      className="w-full text-left px-2.5 py-1.5 rounded-xl hover:bg-slate-100 text-slate-700 transition-colors flex items-center justify-between text-xs cursor-pointer"
                                    >
                                      <span className="flex items-center gap-2 truncate">
                                        <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                        <span className="truncate font-medium">{preset.name}</span>
                                      </span>
                                      <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                        {preset.size}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Message Text Input */}
                          <div className="relative flex-1">
                            <input
                              type="text"
                              value={messageInput}
                              onChange={(e) => setMessageInput(e.target.value)}
                              placeholder={
                                attachment
                                  ? `Add an optional caption for ${attachment.name}...`
                                  : `Message #${selectedChannel.name}...`
                              }
                              className="w-full px-4 py-2.5 bg-slate-50 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-2xl text-xs sm:text-sm text-slate-900 outline-none transition-all"
                            />
                          </div>

                          {/* Send Button */}
                          <button
                            type="submit"
                            disabled={isSending || (!messageInput.trim() && !attachment)}
                            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold text-xs sm:text-sm rounded-2xl transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
                          >
                            <Send className="w-4 h-4" />
                            <span className="hidden sm:inline">Send</span>
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* =================================================================== */}
              {/* SUB-TAB 2: OFFICIAL CIRCLE ANNOUNCEMENTS */}
              {/* =================================================================== */}
              {activeCircleTab === 'announcements' && (
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm sm:text-base text-slate-900">
                        Official Group Announcements
                      </h4>
                      <p className="text-xs text-slate-500">
                        Faculty & Coordinator notices synced to the campus board
                      </p>
                    </div>

                    {isCircleAdmin && (
                      <button
                        type="button"
                        onClick={() => setShowMakeAnnouncementModal(true)}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                      >
                        <Megaphone className="w-3.5 h-3.5" />
                        <span>Publish Notice</span>
                      </button>
                    )}
                  </div>

                  {circleAnnouncements.length === 0 ? (
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-2">
                      <Megaphone className="w-8 h-8 mx-auto opacity-30 text-blue-600" />
                      <h5 className="font-bold text-sm text-slate-700">No official notices posted yet</h5>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Official academic circulations and deadlines for #{selectedChannel.name} will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {circleAnnouncements.map((ann) => (
                        <div
                          key={ann.id}
                          className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-2"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-mono text-blue-600 font-bold">
                              By {ann.authorName} ({ann.authorRole})
                            </span>
                            <span className="text-slate-400 font-mono">
                              {formatMsgTime(ann.timestamp)}
                            </span>
                          </div>
                          <h5 className="font-bold text-sm text-slate-900">{ann.title}</h5>
                          <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">
                            {ann.content}
                          </p>
                          {ann.deadline && (
                            <div className="text-[11px] text-amber-700 font-semibold font-mono">
                              Deadline: {ann.deadline}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* =================================================================== */}
              {/* SUB-TAB 3: GROUP MEMBERS & WHATSAPP ADMIN MANAGEMENT */}
              {/* =================================================================== */}
              {activeCircleTab === 'members' && (
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-bold text-sm sm:text-base text-slate-900">
                        Group Participants ({members.length})
                      </h4>
                      <p className="text-xs text-slate-500">
                        {circleAdminIds.length} group admin{circleAdminIds.length > 1 ? 's' : ''}
                      </p>
                    </div>

                    {canAddMembers && (
                      <button
                        type="button"
                        onClick={handleOpenAddMemberModal}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>Add Members</span>
                      </button>
                    )}
                  </div>

                  {/* Members List with WhatsApp Admin Controls */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {members.map((member) => {
                      const isAdm =
                        circleAdminIds.includes(member.id) ||
                        member.id === selectedChannel.creatorId ||
                        member.role === 'admin';
                      const isSelf = member.id === currentUser.id;

                      return (
                        <div
                          key={member.id}
                          className="bg-white rounded-2xl border border-slate-200 p-3.5 shadow-2xs space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-700 font-bold flex items-center justify-center font-mono text-xs shrink-0">
                                {member.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <h5 className="font-bold text-xs sm:text-sm text-slate-900 truncate">
                                    {member.name}
                                  </h5>
                                  {isSelf && (
                                    <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-semibold">
                                      You
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-500 font-mono truncate">
                                  {member.rollNo || 'AIDS-25-01'} · {member.departmentName || 'Engineering'}
                                </div>
                              </div>
                            </div>

                            {isAdm && (
                              <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 shrink-0">
                                Group Admin
                              </span>
                            )}
                          </div>

                          {/* Contact and Admin Actions */}
                          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                            <div className="flex items-center gap-1.5 text-slate-500 font-mono text-[11px] truncate">
                              <Mail className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                              <span className="truncate">{member.email}</span>
                            </div>

                            {/* WhatsApp Admin Options (Make Admin, Dismiss Admin, Remove) */}
                            {isCircleAdmin && !isSelf && (
                              <div className="flex items-center gap-1 shrink-0 ml-2">
                                {isAdm ? (
                                  <button
                                    type="button"
                                    onClick={() => handleDismissAdmin(member.id)}
                                    className="text-[11px] text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer"
                                    title="Dismiss as Group Admin"
                                  >
                                    Dismiss Admin
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleMakeAdmin(member.id)}
                                    className="text-[11px] text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded font-semibold transition-colors cursor-pointer"
                                    title="Appoint as Group Admin"
                                  >
                                    Make Admin
                                  </button>
                                )}

                                <button
                                  type="button"
                                  onClick={() => handleRemoveMember(member.id)}
                                  className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Remove from group"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center space-y-2">
              <MessageSquare className="w-12 h-12 opacity-30 text-blue-600" />
              <h3 className="font-bold text-base text-slate-700">Select a College Group</h3>
              <p className="text-xs text-slate-400 max-w-sm">
                Pick a class group, tech fest committee, or sports squad from the left list to begin messaging.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: ADD MEMBERS MODAL (Fixed, Reliable, No Broken URL Hash) */}
      {/* ========================================================================= */}
      {showAddMemberModal && selectedChannel && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
                  <UserPlus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-slate-900">
                    Add Members to {selectedChannel.title}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Share an invite link or add registered students and faculty by name
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseAddMemberModal}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tab Switcher: Share Link vs Search Students */}
            <div className="flex border-b border-slate-200 bg-slate-50/40 px-6 pt-3">
              <button
                type="button"
                onClick={() => setAddMemberTab('link')}
                className={`flex-1 pb-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                  addMemberTab === 'link'
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Link className="w-4 h-4" />
                <span>Share Group Link</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setAddMemberTab('search');
                  if (selectedChannel) void loadStudentsDirectory(selectedChannel.id);
                }}
                className={`flex-1 pb-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center justify-center gap-2 transition-colors cursor-pointer ${
                  addMemberTab === 'search'
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Search className="w-4 h-4" />
                <span>Search & Add Directly</span>
              </button>
            </div>

            {/* OPTION 1: SHARE CIRCLE LINK */}
            {addMemberTab === 'link' && (
              <div className="p-6 space-y-5 text-xs sm:text-sm">
                <div className="p-4 bg-blue-50/80 rounded-2xl border border-blue-200 space-y-3">
                  <div className="flex items-center gap-2 text-blue-900 font-bold">
                    <Sparkles className="w-4 h-4 text-blue-600" />
                    <span>Instant WhatsApp Group Join Link</span>
                  </div>
                  <p className="text-xs text-blue-900/80 leading-relaxed">
                    Students from {currentInstitution.name} clicking this link will immediately be verified and enrolled into #{selectedChannel.name}.
                  </p>

                  <div className="flex items-center gap-2 bg-white p-2.5 rounded-xl border border-blue-200">
                    <input
                      type="text"
                      readOnly
                      value={inviteLink}
                      className="w-full text-xs font-mono text-slate-700 bg-transparent outline-none truncate"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(inviteLink)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-lg flex items-center gap-1.5 transition-colors shrink-0 shadow-2xs cursor-pointer"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Share directly on WhatsApp */}
                <div className="pt-2">
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(
                      `Join our official college group "${selectedChannel.title}" on MyCollege: ${inviteLink}`
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-2xl flex items-center justify-center gap-2 shadow-2xs transition-colors"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>Share on WhatsApp</span>
                  </a>
                </div>
              </div>
            )}

            {/* OPTION 2: SEARCH & ADD DIRECTLY FROM ROSTER */}
            {addMemberTab === 'search' && (() => {
              const cleanQuery = studentSearchQuery.trim().toLowerCase();
              const searchTokens = cleanQuery.split(/[\s,._-]+/).filter(Boolean);
              const isEmailInput = cleanQuery.includes('@') && cleanQuery.includes('.');

              const filteredCandidates = allStudentsDirectory.filter((s) => {
                if (searchTokens.length === 0) return true;
                const searchable = [
                  s.name || '',
                  s.email || '',
                  s.rollNo || '',
                  s.designation || '',
                  s.role || '',
                ].join(' ').toLowerCase();

                return searchTokens.every((token) => searchable.includes(token));
              });

              return (
                <div className="p-6 space-y-3">
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        name="student-member-search"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck="false"
                        value={studentSearchQuery}
                        onChange={(e) => setStudentSearchQuery(e.target.value)}
                        placeholder="Search by student name, roll number, or email..."
                        className="w-full pl-9 pr-9 py-2.5 bg-slate-50 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-xl text-xs text-slate-900 outline-none transition-all shadow-2xs"
                        autoFocus
                      />
                      {studentSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setStudentSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
                          title="Clear search"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Active filter count feedback */}
                    {cleanQuery && (
                      <div className="flex items-center justify-between text-[11px] px-1 text-slate-500">
                        <span>
                          {filteredCandidates.length === 0
                            ? 'No matches'
                            : filteredCandidates.length === 1
                              ? '1 matching person found'
                              : `${filteredCandidates.length} matching people found`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setStudentSearchQuery('')}
                          className="text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
                        >
                          Reset
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-2xl border border-slate-200">
                    {isLoadingStudents ? (
                      <div className="p-6 text-center text-xs text-slate-400">Loading user directory...</div>
                    ) : studentDirectoryError ? (
                      <div className="p-6 text-center space-y-3">
                        <p className="text-xs text-rose-600">{studentDirectoryError}</p>
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedChannel) void loadStudentsDirectory(selectedChannel.id);
                          }}
                          className="text-xs font-semibold text-blue-700 hover:text-blue-800 cursor-pointer"
                        >
                          Try again
                        </button>
                      </div>
                    ) : allStudentsDirectory.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">No students or faculty found.</div>
                    ) : filteredCandidates.length === 0 ? (
                      <div className="p-6 text-center space-y-3">
                        <p className="text-xs text-slate-500">
                          No student or faculty found matching "{studentSearchQuery}".
                        </p>
                        {isEmailInput ? (
                          <button
                            type="button"
                            onClick={() => handleAddMemberDirect({
                              id: null,
                              name: cleanQuery.split('@')[0].replace(/[._]/g, ' '),
                              email: cleanQuery,
                              role: 'student',
                              membershipStatus: 'not_added',
                            })}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Add {cleanQuery} directly</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setStudentSearchQuery('')}
                            className="text-blue-600 hover:text-blue-700 font-semibold text-xs underline cursor-pointer"
                          >
                            Clear search filter
                          </button>
                        )}
                      </div>
                    ) : (
                      filteredCandidates.map((student) => {
                        const isAlreadyMember =
                          student.membershipStatus === 'active' ||
                          members.some((member) => (member.email || '').toLowerCase() === (student.email || '').toLowerCase());
                        const isPending = student.membershipStatus === 'pending';
                        const isAddedJustNow = copiedId === `added-${student.email}`;
                        const displayName = student.name && student.name !== student.email
                          ? student.name
                          : student.email.split('@')[0].replace(/[._]/g, ' ');
                        const initials = (
                          displayName.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2) ||
                          displayName.slice(0, 2)
                        ).toUpperCase();

                        return (
                          <div
                            key={student.email || student.id}
                            className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0">
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <div className="font-bold text-xs text-slate-900 truncate">
                                  {displayName}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono truncate">
                                  {student.role === 'faculty'
                                    ? student.designation || 'Faculty'
                                    : student.rollNo || 'Student'} · {student.email}
                                </div>
                              </div>
                            </div>

                            {isAlreadyMember || isPending || isAddedJustNow ? (
                              <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg flex items-center gap-1 shrink-0">
                                <Check className="w-3 h-3 text-emerald-600" />
                                <span>{isPending ? 'Invitation pending' : isAddedJustNow ? 'Added!' : 'Member'}</span>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleAddMemberDirect(student)}
                                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl flex items-center gap-1 transition-colors shrink-0 shadow-2xs cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Add</span>
                              </button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: WHATSAPP CREATE POLL MODAL */}
      {/* ========================================================================= */}
      {showCreatePollModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-base text-slate-900">Create WhatsApp Poll</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreatePollModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePoll} className="p-6 space-y-4 text-xs sm:text-sm">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700">Poll Question</label>
                <input
                  type="text"
                  required
                  value={pollQuestion}
                  onChange={(e) => setPollQuestion(e.target.value)}
                  placeholder="e.g. Preferred time for AI Lab Extra Lecture?"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-slate-900 outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="font-bold text-slate-700">Options</label>
                {pollOptions.map((opt, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="w-5 text-slate-400 font-mono text-xs">{idx + 1}.</span>
                    <input
                      type="text"
                      required={idx < 2}
                      value={opt}
                      onChange={(e) => {
                        const updated = [...pollOptions];
                        updated[idx] = e.target.value;
                        setPollOptions(updated);
                      }}
                      placeholder={`Option ${idx + 1}`}
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-slate-900 outline-none"
                    />
                    {pollOptions.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setPollOptions(pollOptions.filter((_, i) => i !== idx))}
                        className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}

                {pollOptions.length < 5 && (
                  <button
                    type="button"
                    onClick={() => setPollOptions([...pollOptions, ''])}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 pt-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Option</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="multiAnswers"
                  checked={pollAllowMultiple}
                  onChange={(e) => setPollAllowMultiple(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="multiAnswers" className="text-xs text-slate-700 cursor-pointer">
                  Allow multiple answers
                </label>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowCreatePollModal(false)}
                  className="px-4 py-2 text-slate-600 font-semibold rounded-xl hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-2xs cursor-pointer"
                >
                  Send Poll
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: WHATSAPP GROUP SETTINGS & PERMISSIONS (Admins Only) */}
      {/* ========================================================================= */}
      {showGroupSettingsModal && selectedChannel && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-base text-slate-900">Group Settings</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowGroupSettingsModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs sm:text-sm">
              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700">Group Title</label>
                <input
                  type="text"
                  value={groupTitleInput}
                  onChange={(e) => setGroupTitleInput(e.target.value)}
                  maxLength={80}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-slate-900 outline-none text-xs sm:text-sm font-medium"
                  placeholder="Group title"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-semibold text-slate-700">Group Description</label>
                <textarea
                  value={groupDescInput}
                  onChange={(e) => setGroupDescInput(e.target.value)}
                  maxLength={300}
                  rows={3}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-slate-900 outline-none text-xs sm:text-sm"
                  placeholder="Group description..."
                />
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="font-bold text-slate-900">Send Messages</h5>
                    <p className="text-xs text-slate-500">
                      Choose who can send messages to #{selectedChannel.name}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={onlyAdminsMessage}
                    onChange={(e) => setOnlyAdminsMessage(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                </div>
                <div className="text-[11px] text-slate-600">
                  {onlyAdminsMessage ? (
                    <span className="text-amber-700 font-semibold">
                      🔒 Only Group Admins can send messages (Announcement mode)
                    </span>
                  ) : (
                    <span className="text-emerald-700 font-semibold">
                      👥 All participants can send messages
                    </span>
                  )}
                </div>
              </div>

              {/* Danger Zone: Delete Group */}
              <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between">
                <div>
                  <h6 className="font-bold text-rose-900 text-xs">Delete This Group</h6>
                  <p className="text-[11px] text-rose-600">Permanently delete this group and all messages.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirmModal(true)}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-xl shadow-2xs transition-colors cursor-pointer"
                >
                  Delete
                </button>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowGroupSettingsModal(false)}
                  className="px-4 py-2 text-slate-600 font-semibold rounded-xl hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveGroupSettings}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-2xs cursor-pointer"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Group Confirmation Modal */}
      {showDeleteConfirmModal && selectedChannel && (
        <div className="fixed inset-0 z-60 overflow-y-auto bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl border border-rose-100 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto">
                <Trash2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-base text-slate-900">Delete Group?</h3>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Are you sure you want to delete <strong className="text-slate-800">"{selectedChannel.title}"</strong>? All chat messages, media, and records in this group will be deleted permanently. This action cannot be undone.
                </p>
              </div>
              <div className="pt-2 flex items-center justify-center gap-3">
                <button
                  type="button"
                  disabled={isDeletingGroup}
                  onClick={() => setShowDeleteConfirmModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeletingGroup}
                  onClick={handleDeleteGroup}
                  className="px-5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {isDeletingGroup ? 'Deleting...' : 'Yes, Delete Group'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: MAKE ANNOUNCEMENT MODAL */}
      {/* ========================================================================= */}
      {showMakeAnnouncementModal && selectedChannel && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold text-base text-slate-900">Broadcast Official Notice</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowMakeAnnouncementModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePublishCircleAnnouncement} className="p-6 space-y-4 text-xs sm:text-sm">
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700">Notice Title</label>
                <input
                  type="text"
                  required
                  value={annTitle}
                  onChange={(e) => setAnnTitle(e.target.value)}
                  placeholder="e.g. Mid-Semester Lab Assessment Schedules"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-slate-900 outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-slate-700">Content / Instructions</label>
                <textarea
                  required
                  rows={4}
                  value={annContent}
                  onChange={(e) => setAnnContent(e.target.value)}
                  placeholder="Provide complete academic details, venue, and requirements..."
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 focus:border-blue-500 rounded-xl text-slate-900 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-700">Priority Level</label>
                  <select
                    value={annPriority}
                    onChange={(e) => setAnnPriority(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 outline-none"
                  >
                    <option value="normal">Normal Notice</option>
                    <option value="high">High Importance</option>
                    <option value="urgent">🚨 Urgent (Sticky)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-bold text-slate-700">Deadline (Optional)</label>
                  <input
                    type="date"
                    value={annDeadline}
                    onChange={(e) => setAnnDeadline(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 outline-none"
                  >
                  </input>
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowMakeAnnouncementModal(false)}
                  className="px-4 py-2 text-slate-600 font-semibold rounded-xl hover:bg-slate-100 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPublishingAnn}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-2xs cursor-pointer"
                >
                  {isPublishingAnn ? 'Publishing...' : 'Publish to Group & Board'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: ATTACHMENT PREVIEW & DOWNLOAD MODAL */}
      {/* ========================================================================= */}
      {previewAttachmentModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
          <div className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2 truncate">
                <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                <h4 className="font-bold text-sm text-slate-900 truncate">
                  {previewAttachmentModal.name}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setPreviewAttachmentModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {previewAttachmentModal.previewUrl ? (
                <div className="max-h-72 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 flex items-center justify-center">
                  <img
                    src={previewAttachmentModal.previewUrl}
                    alt={previewAttachmentModal.name}
                    className="max-h-72 object-contain"
                  />
                </div>
              ) : (
                <div className="p-8 bg-blue-50/70 rounded-2xl border border-blue-200 text-center space-y-2">
                  <FileText className="w-12 h-12 text-blue-600 mx-auto" />
                  <div className="font-bold text-sm text-slate-900">{previewAttachmentModal.name}</div>
                  <div className="text-xs text-slate-500 font-mono">
                    Size: {previewAttachmentModal.size} · Type: {previewAttachmentModal.type}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-500 font-mono">Verified Campus Document</span>
                {previewAttachmentModal.url ? (
                  <a
                    href={previewAttachmentModal.url}
                    download={previewAttachmentModal.name}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 shadow-2xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download File</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      showToast(`Downloaded ${previewAttachmentModal.name} (${previewAttachmentModal.size})`, 'success');
                      setPreviewAttachmentModal(null);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download File</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showCreateGroupModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-bold text-slate-900">Create a Group</h3>
              <button
                type="button"
                onClick={() => setShowCreateGroupModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
                aria-label="Close create group dialog"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateGroup} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="new-group-title">
                  Group name
                </label>
                <input
                  id="new-group-title"
                  required
                  maxLength={80}
                  value={newGroupTitle}
                  onChange={(event) => setNewGroupTitle(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="new-group-description">
                  Description
                </label>
                <textarea
                  id="new-group-description"
                  rows={3}
                  maxLength={300}
                  value={newGroupDescription}
                  onChange={(event) => setNewGroupDescription(event.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="new-group-type">
                  Group type
                </label>
                <select
                  id="new-group-type"
                  value={newGroupType}
                  onChange={(event) => setNewGroupType(event.target.value as ChannelType)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 bg-white cursor-pointer"
                >
                  <option value="class">Academic & Class</option>
                  <option value="interest">Tech & AI</option>
                  <option value="club">Clubs & Sports</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateGroupModal(false)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingGroup || !newGroupTitle.trim()}
                  className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg font-semibold"
                >
                  {isCreatingGroup ? 'Creating...' : 'Create Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating In-App Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-2xl border backdrop-blur-md animate-in slide-in-from-bottom-5 duration-200 bg-slate-900 text-white border-slate-800">
          <div
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              toast.type === 'success'
                ? 'bg-emerald-400'
                : toast.type === 'error'
                ? 'bg-rose-400'
                : 'bg-blue-400'
            }`}
          />
          <p className="text-xs font-semibold text-slate-100 max-w-sm">{toast.message}</p>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-white p-1 text-xs ml-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
};
