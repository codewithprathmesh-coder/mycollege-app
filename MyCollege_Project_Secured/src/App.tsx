import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  Announcement,
  AppNotification,
  Department,
  Division,
  EventRegistration,
  Institution,
  ChatChannel,
  ChatMessage,
  User,
} from './types';
import { api, setActiveUserId, clearSession, getSessionToken } from './services/api';
import { Header } from './components/Header';
import { NavigationTabs, MobileNav, type ActiveTab } from './components/NavigationTabs';
import { HomeView } from './views/HomeView';
import { ExploreView } from './views/ExploreView';
import { ChatView } from './views/ChatView';
import { ActivitiesView } from './views/ActivitiesView';
import { FacultyDeskView } from './views/FacultyDeskView';
import { AdminConsoleView } from './views/AdminConsoleView';
import { BatchDirectoryView } from './views/BatchDirectoryView';
import { AnnouncementModal } from './components/AnnouncementModal';
import { CreateAnnouncementModal } from './components/CreateAnnouncementModal';
import { NotificationsPopover } from './components/NotificationsPopover';
import { UserProfileModal } from './components/UserProfileModal';
import { PreferenceSetupModal } from './components/PreferenceSetupModal';
import { LoginView } from './components/LoginView';
import { ProfileSetupView } from './components/ProfileSetupView';
import { TermsAndConditions } from './components/TermsAndConditions';

type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';
type AuthState = 'checking' | 'unauthenticated' | 'terms_required' | 'profile_setup' | 'authenticated';

interface RealtimeEvent {
  type: string;
  channelId?: string;
  channel?: ChatChannel;
  message?: ChatMessage;
  [key: string]: unknown;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<AuthState>('checking');
  // Light and dark theme
const [theme, setTheme] = useState<'light' | 'dark'>(() => {
  const savedTheme = localStorage.getItem('mycollege-theme');
  return savedTheme === 'dark' ? 'dark' : 'light';
});

useEffect(() => {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('mycollege-theme', theme);
}, [theme]);

const toggleTheme = () => {
  setTheme((current) => (current === 'light' ? 'dark' : 'light'));
};
  const [userDivisions, setUserDivisions] = useState<Division[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [currentInstitution, setCurrentInstitution] = useState<Institution | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);

  // Announcements & Data
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [registrations, setRegistrations] = useState<EventRegistration[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  // Navigation & Filtering
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSort, setSelectedSort] = useState<string>('relevant');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeChannelIdForChat, setActiveChannelIdForChat] = useState<string | undefined>(undefined);

  // Modals & Panels
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showPreferenceSetup, setShowPreferenceSetup] = useState(false);
  const [isChatConversationActive, setIsChatConversationActive] = useState(false);
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const chatBackActionRef = useRef<(() => void) | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingDelayed, setLoadingDelayed] = useState(false);

  // Watchdog timer: under no circumstances can initial load hang indefinitely
  useEffect(() => {
    const delayTimer = setTimeout(() => {
      setLoadingDelayed(true);
    }, 3500);

    const hardWatchdog = setTimeout(() => {
      setIsLoading((loading) => {
        if (loading) {
          console.warn('[FAILSAFE] Watchdog triggered: forcing unauthenticated view.');
          setAuthState((curr) => (curr === 'checking' ? 'unauthenticated' : curr));
          return false;
        }
        return false;
      });
    }, 6000);

    return () => {
      clearTimeout(delayTimer);
      clearTimeout(hardWatchdog);
    };
  }, []);

  // In-app toast feedback replacing window.alert
  const [appToast, setAppToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setAppToast({ message, type });
    setTimeout(() => {
      setAppToast((prev) => (prev?.message === message ? null : prev));
    }, 3500);
  };

  // Initial load
  const loadInitialData = useCallback(async () => {
    try {
      setIsLoading(true);

      // If user has no saved session token in storage, transition immediately to login view
      const token = getSessionToken();
      if (!token) {
        setCurrentUser(null);
        setCurrentInstitution(null);
        setAuthState('unauthenticated');
        setIsLoading(false);
        return;
      }

      const sessionRes = await api.getAuthSession().catch(() => ({
        authenticated: false,
        user: null,
        divisions: [],
      }));

      if (!sessionRes.authenticated || !sessionRes.user) {
        setCurrentUser(null);
        setCurrentInstitution(null);
        setAuthState('unauthenticated');
        return;
      }

      const user = sessionRes.user;
      setCurrentUser(user);
      if (user.role === 'faculty') setActiveTab('desk');
      setUserDivisions(sessionRes.divisions || []);

      if ((user.role === 'faculty' || !user.isProfileCompleted) && !user.termsAcceptedAt) {
        setAuthState('terms_required');
        return;
      }

      const instRes = await api.getInstitutions().catch(() => ({ institutions: [] }));
      const fallbackInst: Institution = {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'K. J. Somaiya institute of Engineering & Information Technology (KJSIEIT)',
        shortName: 'KJSIEIT',
        domain: 'somaiya.edu',
        allowedDomains: ['somaiya.edu', 'kjsieit.edu.in'],
        requireApproval: true,
        city: 'Sion, Mumbai, Maharashtra',
        established: '2003',
      };
      const instList = instRes.institutions && instRes.institutions.length > 0 ? instRes.institutions : [fallbackInst];
      setInstitutions(instList);
      const defaultInst = instList[0];
      const activeInst =
        instList.find((i) => i.id === user.institutionId) || defaultInst;
      setCurrentInstitution(activeInst);

      if (!user.isProfileCompleted) {
        setAuthState('profile_setup');
        setIsLoading(false);
        return;
      }

      setAuthState('authenticated');

      const [deptRes, usersRes, savedRes, regRes, notifRes] = await Promise.all([
        api.getDepartments(activeInst.id).catch(() => ({ departments: [] })),
        api.getUsers(activeInst.id).catch(() => ({ users: [] })),
        api.getSavedAnnouncements().catch(() => ({ savedIds: [] })),
        api.getRegistrations().catch(() => ({ registrations: [] })),
        api.getNotifications().catch(() => ({ notifications: [] })),
      ]);

      setDepartments(deptRes.departments || []);
      setAllUsers(usersRes.users || []);
      setSavedIds(savedRes.savedIds || []);
      setRegistrations(regRes.registrations || []);
      setNotifications(notifRes.notifications || []);

      try {
        const annRes = await api.getAnnouncements({
          institutionId: activeInst.id,
          category: selectedCategory,
          sort: selectedSort,
          search: searchQuery,
        });
        setAnnouncements(annRes.announcements || []);
      } catch (annErr) {
        console.warn('Could not load announcements initially:', annErr);
      }
    } catch (err) {
      console.error('Error loading initial data:', err);
      setAuthState('unauthenticated');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory, selectedSort, searchQuery]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (!currentUser || !['authenticated', 'terms_required', 'profile_setup'].includes(authState)) {
      return;
    }

    const refreshIntervalMs = 12 * 60 * 60 * 1000;
    let lastRefreshAt = 0;
    let refreshInProgress = false;

    const refreshSession = async () => {
      if (refreshInProgress) return;
      refreshInProgress = true;
      try {
        const session = await api.getAuthSession();
        if (!session.authenticated) {
          console.warn('The server no longer recognizes the active sign-in session.');
          return;
        }
        lastRefreshAt = Date.now();
      } catch (error) {
        console.error('Could not refresh the sign-in session; it will be retried:', error);
      } finally {
        refreshInProgress = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshSession();
    }, refreshIntervalMs);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefreshAt >= refreshIntervalMs) {
        void refreshSession();
      }
    };

    void refreshSession();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [authState, currentUser?.id]);

  // Reload announcements on filter change
  const fetchAnnouncements = useCallback(async () => {
    if (!currentInstitution) return;
    try {
      const res = await api.getAnnouncements({
        institutionId: currentInstitution.id,
        category: selectedCategory,
        sort: selectedSort,
        search: searchQuery,
      });
      setAnnouncements(res.announcements);
    } catch (err) {
      console.error('Failed to load announcements:', err);
    }
  }, [currentInstitution, selectedCategory, selectedSort, searchQuery]);

  const fetchAnnouncementsRef = useRef(fetchAnnouncements);
  useEffect(() => {
    fetchAnnouncementsRef.current = fetchAnnouncements;
  }, [fetchAnnouncements]);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  useEffect(() => {
    if (authState !== 'authenticated' || !currentUser) {
      setRealtimeStatus('offline');
      return;
    }

    let shouldReconnect = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let socket: WebSocket | undefined;
    let retryCount = 0;

    const connect = () => {
      setRealtimeStatus(retryCount === 0 ? 'connecting' : 'reconnecting');
      let wsHost = window.location.host;
      let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      if (
        window.location.protocol === 'capacitor:' ||
        (window.location.hostname === 'localhost' && !window.location.port)
      ) {
        wsHost = 'mycollege-app.onrender.com';
        protocol = 'wss:';
      }
      socket = new WebSocket(`${protocol}//${wsHost}`);

      socket.onmessage = (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch (err) {
          console.error('Received invalid realtime event:', err);
          return;
        }
        if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) return;

        const message = parsed as RealtimeEvent;
        if (message.type === 'auth:ok') {
          retryCount = 0;
          setRealtimeStatus('connected');
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'ping' }));
            }
          }, 25000);
          window.dispatchEvent(new CustomEvent('mycollege:realtime', { detail: { type: 'connection:restored' } }));
          void fetchAnnouncementsRef.current();
          void api.getNotifications().then((response) => setNotifications(response.notifications)).catch((err) => {
            console.error('Failed to refresh notifications after realtime connection:', err);
          });
          return;
        }

        window.dispatchEvent(new CustomEvent('mycollege:realtime', { detail: message }));
        if (message.type === 'announcements:changed') {
          void fetchAnnouncementsRef.current();
        } else if (message.type === 'notifications:changed') {
          void api.getNotifications().then((response) => setNotifications(response.notifications)).catch((err) => {
            console.error('Failed to refresh live notifications:', err);
          });
        } else if (message.type === 'registrations:changed') {
          void api.getRegistrations().then((response) => setRegistrations(response.registrations)).catch((err) => {
            console.error('Failed to refresh live registrations:', err);
          });
        }
      };

      socket.onerror = (event) => {
        console.error('Realtime connection error:', event);
      };

      socket.onclose = (event) => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (!shouldReconnect) return;
        if (event.code === 1008) {
          setRealtimeStatus('offline');
          clearSession();
          setCurrentUser(null);
          setAuthState('unauthenticated');
          return;
        }

        retryCount += 1;
        setRealtimeStatus('reconnecting');
        const delay = Math.min(1000 * (2 ** Math.min(retryCount - 1, 4)), 15000);
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      shouldReconnect = false;
      if (retryTimer) clearTimeout(retryTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      socket?.close();
    };
  }, [authState, currentUser?.id]);

  const announcementsRef = useRef<Announcement[]>([]);
  useEffect(() => {
    announcementsRef.current = announcements;
  }, [announcements]);

  // Keep internal stack of visited screens so back button ALWAYS returns to the before screen
  const navigationHistoryRef = useRef<ActiveTab[]>(['home']);
  const historyInitializedRef = useRef(false);

  // Handle browser history back / forward integration so back button returns to prior screen without exiting app
  useEffect(() => {
    const validTabs: ActiveTab[] = ['home', 'explore', 'chat', 'directory', 'activities', 'desk', 'admin'];
    const initialHash = window.location.hash.replace('#', '');
    const matchedTab = validTabs.find((t) => t === initialHash);

    if (!historyInitializedRef.current) {
      window.history.replaceState(
        { tab: matchedTab || 'home', modal: null },
        '',
        window.location.pathname + window.location.search + (matchedTab && matchedTab !== 'home' ? `#${matchedTab}` : '')
      );

      if (matchedTab) {
        setActiveTab(matchedTab);
        navigationHistoryRef.current = ['home', matchedTab];
      }
      historyInitializedRef.current = true;
    }

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      const currentHash = window.location.hash.replace('#', '');

      // 1. If any modal is open, back button should close the modal first and stay on current screen
      if (selectedAnnouncement || showCreateModal || showNotifications || showProfile || showPreferenceSetup) {
        setSelectedAnnouncement(null);
        setShowCreateModal(false);
        setEditingAnnouncement(null);
        setShowNotifications(false);
        setShowProfile(false);
        setShowPreferenceSetup(false);
        window.history.pushState(
          { tab: activeTab, modal: null },
          '',
          window.location.pathname + window.location.search + (activeTab === 'home' ? '' : `#${activeTab}`)
        );
        return;
      }

      // 2. Announcement Modal Check from direct link/history
      if (state?.modal === 'announcement' && state.announcementId) {
        const found = announcementsRef.current.find((a) => a.id === state.announcementId);
        if (found) {
          setSelectedAnnouncement(found);
          setShowCreateModal(false);
          setShowNotifications(false);
          setShowProfile(false);
          setShowPreferenceSetup(false);
          return;
        }
      }

      if (currentHash.startsWith('notice-')) {
        const id = currentHash.replace('notice-', '');
        const found = announcementsRef.current.find((a) => a.id === id);
        if (found) {
          setSelectedAnnouncement(found);
          setShowCreateModal(false);
          setShowNotifications(false);
          setShowProfile(false);
          setShowPreferenceSetup(false);
          return;
        }
      }

      // 3. Other Modals Check
      if (state?.modal === 'create' || currentHash === 'create-notice') {
        setShowCreateModal(true);
        setSelectedAnnouncement(null);
        setShowNotifications(false);
        setShowProfile(false);
        setShowPreferenceSetup(false);
        return;
      }

      if (state?.modal === 'preferences' || currentHash === 'preferences') {
        setShowPreferenceSetup(true);
        setSelectedAnnouncement(null);
        setShowCreateModal(false);
        setShowNotifications(false);
        setShowProfile(false);
        return;
      }

      if (state?.modal === 'notifications' || currentHash === 'notifications') {
        setShowNotifications(true);
        setSelectedAnnouncement(null);
        setShowCreateModal(false);
        setShowProfile(false);
        setShowPreferenceSetup(false);
        return;
      }

      if (state?.modal === 'profile' || currentHash === 'profile') {
        setShowProfile(true);
        setSelectedAnnouncement(null);
        setShowCreateModal(false);
        setShowNotifications(false);
        setShowPreferenceSetup(false);
        return;
      }

      // 4. If current hash is chat-related, keep activeTab as chat
      if (currentHash.startsWith('circle-') || currentHash === 'chat') {
        setActiveTab('chat');
        return;
      }

      // 5. Update tab safely from history stack
      if (state?.tab && validTabs.includes(state.tab)) {
        setActiveTab(state.tab);
      } else {
        const tabFromHash = validTabs.find((t) => t === currentHash);
        if (tabFromHash) {
          setActiveTab(tabFromHash);
        } else {
          // Navigated past beginning of stack -> keep user safely on home screen instead of exiting app!
          if (activeTab !== 'home') {
            setActiveTab('home');
            navigationHistoryRef.current = ['home'];
          }
          window.history.pushState({ tab: 'home', modal: null }, '', window.location.pathname);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab, selectedAnnouncement, showCreateModal, showNotifications, showProfile, showPreferenceSetup]);

  // Safe navigation helpers that push browser history
  const navigateToTab = (tab: ActiveTab) => {
    if (activeTab === tab && !selectedAnnouncement && !showCreateModal && !showNotifications && !showProfile && !showPreferenceSetup) {
      return;
    }
    // Close any open modals
    setSelectedAnnouncement(null);
    setShowCreateModal(false);
    setShowNotifications(false);
    setShowProfile(false);
    setShowPreferenceSetup(false);

    // Track in navigation history stack
    if (tab !== activeTab) {
      navigationHistoryRef.current.push(tab);
    }

    window.history.pushState(
      { tab, modal: null },
      '',
      window.location.pathname + window.location.search + (tab === 'home' ? '' : `#${tab}`)
    );
    setActiveTab(tab);
  };

  // Explicit back handler that guarantees returning to before screen
  const handleGoBack = () => {
    // 1. Close open modals first
    if (selectedAnnouncement) {
      handleCloseAnnouncement();
      return;
    }
    if (showCreateModal) {
      handleCloseCreateModal();
      return;
    }
    if (showNotifications) {
      handleCloseNotifications();
      return;
    }
    if (showProfile) {
      handleCloseProfile();
      return;
    }
    if (showPreferenceSetup) {
      handleClosePreferences();
      return;
    }

    // 2. If inside a channel conversation on the chat tab, return to groups list
    if (activeTab === 'chat' && isChatConversationActive && chatBackActionRef.current) {
      chatBackActionRef.current();
      return;
    }

    // 3. Return to previous screen on the navigation stack
    if (navigationHistoryRef.current.length > 1) {
      navigationHistoryRef.current.pop(); // remove current screen
      const prevTab = navigationHistoryRef.current[navigationHistoryRef.current.length - 1] || 'home';
      setActiveTab(prevTab);
      window.history.pushState(
        { tab: prevTab, modal: null },
        '',
        window.location.pathname + window.location.search + (prevTab === 'home' ? '' : `#${prevTab}`)
      );
    } else if (activeTab !== 'home') {
      setActiveTab('home');
      navigationHistoryRef.current = ['home'];
      window.history.pushState({ tab: 'home', modal: null }, '', window.location.pathname);
    }
  };

  const handleSavePreferences = async (ordered: [string, string, string]) => {
    if (!currentUser) return;
    const res = await api.updatePreferences({ orderedPreferences: ordered });
    setCurrentUser(res.user);
    setAllUsers((prev) => prev.map((u) => (u.id === res.user.id ? res.user : u)));
  };

  const handleOpenAnnouncement = (ann: Announcement) => {
    window.history.pushState(
      { tab: activeTab, modal: 'announcement', announcementId: ann.id },
      '',
      window.location.pathname + window.location.search + `#notice-${ann.id}`
    );
    setSelectedAnnouncement(ann);
  };

  const handleCloseAnnouncement = () => {
    if (window.history.state?.modal === 'announcement') {
      window.history.back();
    } else {
      setSelectedAnnouncement(null);
    }
  };

  const handleOpenCreateModal = () => {
    setEditingAnnouncement(null);
    window.history.pushState(
      { tab: activeTab, modal: 'create' },
      '',
      window.location.pathname + window.location.search + '#create-notice'
    );
    setShowCreateModal(true);
  };

  const handleCloseCreateModal = () => {
    if (window.history.state?.modal === 'create' || window.history.state?.modal === 'edit') {
      window.history.back();
    } else {
      setShowCreateModal(false);
      setEditingAnnouncement(null);
    }
  };

  const handleEditAnnouncement = (announcement: Announcement) => {
    setEditingAnnouncement(announcement);
    window.history.pushState(
      { tab: activeTab, modal: 'edit' },
      '',
      window.location.pathname + window.location.search + '#edit-notice'
    );
    setShowCreateModal(true);
  };

  const handleOpenNotifications = () => {
    window.history.pushState(
      { tab: activeTab, modal: 'notifications' },
      '',
      window.location.pathname + window.location.search + '#notifications'
    );
    setShowNotifications(true);
  };

  const handleCloseNotifications = () => {
    if (window.history.state?.modal === 'notifications') {
      window.history.back();
    } else {
      setShowNotifications(false);
    }
  };

  const handleOpenProfile = () => {
    window.history.pushState(
      { tab: activeTab, modal: 'profile' },
      '',
      window.location.pathname + window.location.search + '#profile'
    );
    setShowProfile(true);
  };

  const handleCloseProfile = () => {
    if (window.history.state?.modal === 'profile') {
      window.history.back();
    } else {
      setShowProfile(false);
    }
  };

  const handleClosePreferences = () => {
    if (window.history.state?.modal === 'preferences') {
      window.history.back();
    } else {
      setShowPreferenceSetup(false);
    }
  };

  const handleOpenPreferences = () => {
    if (showNotifications) {
      window.history.replaceState(
        { tab: activeTab, modal: 'preferences' },
        '',
        window.location.pathname + window.location.search + '#preferences'
      );
      setShowNotifications(false);
      setShowPreferenceSetup(true);
      return;
    }
    window.history.pushState(
      { tab: activeTab, modal: 'preferences' },
      '',
      window.location.pathname + window.location.search + '#preferences'
    );
    setShowPreferenceSetup(true);
  };

  // Switch Active User (Role Switcher)
  const handleSwitchUser = async (user: User) => {
    setActiveUserId(user.id);
    setCurrentUser(user);

    // If different institution, update institution as well
    if (user.institutionId !== currentInstitution?.id) {
      const inst = institutions.find((i) => i.id === user.institutionId);
      if (inst) setCurrentInstitution(inst);
    }

    try {
      const [savedRes, regRes, notifRes] = await Promise.all([
        api.getSavedAnnouncements(),
        api.getRegistrations(),
        api.getNotifications(),
      ]);
      setSavedIds(savedRes.savedIds);
      setRegistrations(regRes.registrations);
      setNotifications(notifRes.notifications);
      setAuthState('authenticated');
      await fetchAnnouncements();
    } catch (err) {
      console.error(err);
    }
  };

  // Handle successful login from LoginView
  const handleLoginSuccess = async (user: User, isFirstTime: boolean, divisions: Division[]) => {
    setCurrentUser(user);
    setUserDivisions(divisions);
    setActiveUserId(user.id);
    setActiveTab(user.role === 'faculty' ? 'desk' : 'home');
    if ((user.role === 'faculty' || !user.isProfileCompleted) && !user.termsAcceptedAt) {
      setAuthState('terms_required');
      showToast('Authentication verified! Please review and accept the terms to continue.', 'info');
    } else if (isFirstTime || !user.isProfileCompleted) {
      setAuthState('profile_setup');
      showToast('Authentication verified! Complete your profile to access campus modules.', 'success');
    } else {
      setAuthState('authenticated');
      showToast(`Welcome back, ${user.name}!`, 'success');
      await loadInitialData();
    }
  };

  const handleAcceptTerms = async () => {
    const response = await api.acceptTerms();
    setCurrentUser(response.user);
    if (response.user.role === 'faculty') {
      setAuthState('authenticated');
      await loadInitialData();
      return;
    }
    setAuthState('profile_setup');
    showToast('Terms accepted. Please complete your profile to continue.', 'success');
  };

  // Handle profile completion from ProfileSetupView
  const handleProfileCompleted = async (updatedUser: User) => {
    setCurrentUser(updatedUser);
    setActiveUserId(updatedUser.id);
    setActiveTab(updatedUser.role === 'faculty' ? 'desk' : 'home');
    setAuthState('authenticated');
    showToast(`Profile completed! Welcome to MyCollege, @${updatedUser.username || updatedUser.name}`, 'success');
    await loadInitialData();
  };

  // Secure sign out
  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    clearSession();
    setCurrentUser(null);
    setAuthState('unauthenticated');
    showToast('You have signed out safely.', 'info');
  };

  // Switch Institution
  const handleSelectInstitution = async (inst: Institution) => {
    setCurrentInstitution(inst);
    try {
      const [deptRes, usersRes] = await Promise.all([
        api.getDepartments(inst.id),
        api.getUsers(inst.id),
      ]);
      setDepartments(deptRes.departments);
      setAllUsers(usersRes.users);

      // If current user is from different institution, switch to first user of new institution
      if (usersRes.users.length > 0 && currentUser?.institutionId !== inst.id) {
        handleSwitchUser(usersRes.users[0]);
      } else {
        await fetchAnnouncements();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Toggle Save Announcement
  const handleToggleSave = async (id: string) => {
    try {
      const res = await api.toggleSaveAnnouncement(id);
      setSavedIds(res.savedIds);
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === id ? { ...a, metrics: { ...a.metrics, saves: res.isSaved ? a.metrics.saves + 1 : Math.max(0, a.metrics.saves - 1) } } : a))
      );
    } catch (err) {
      console.error('Error toggling save:', err);
    }
  };

  // Register for Event / Hackathon
  const handleRegister = async (announcementId: string) => {
    try {
      const res = await api.registerForEvent(announcementId);
      setRegistrations((prev) => [res.registration, ...prev]);
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === announcementId ? { ...a, metrics: { ...a.metrics, registrations: a.metrics.registrations + 1 } } : a))
      );

      // Update notifications
      const notifRes = await api.getNotifications();
      setNotifications(notifRes.notifications);
      showToast('Successfully registered for this event! Check your Activities tab.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Registration failed', 'error');
    }
  };

  // Cancel Event Registration
  const handleCancelRegistration = async (regId: string) => {
    try {
      await api.cancelRegistration(regId);
      setRegistrations((prev) => prev.filter((r) => r.id !== regId));
      showToast('Registration cancelled', 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel registration', 'error');
    }
  };

  // Approve Announcement (Admin)
  const handleApproveAnnouncement = async (id: string) => {
    try {
      await api.approveAnnouncement(id);
      await fetchAnnouncements();
      const notifRes = await api.getNotifications();
      setNotifications(notifRes.notifications);
      showToast('Announcement approved & published across campus', 'success');
    } catch (err: any) {
      showToast(err.message || 'Approval failed', 'error');
    }
  };

  // Reject Announcement (Admin)
  const handleRejectAnnouncement = async (id: string, reason?: string) => {
    try {
      await api.rejectAnnouncement(id, reason);
      await fetchAnnouncements();
      const notifRes = await api.getNotifications();
      setNotifications(notifRes.notifications);
      showToast('Notice was rejected and returned to author', 'info');
    } catch (err: any) {
      showToast(err.message || 'Rejection failed', 'error');
    }
  };

  // Delete Announcement
  const handleDeleteAnnouncement = async (id: string) => {
    try {
      await api.deleteAnnouncement(id);
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      if (selectedAnnouncement?.id === id) setSelectedAnnouncement(null);
      showToast('Announcement removed', 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete announcement', 'error');
    }
  };

  // Notifications helpers
  const handleMarkNotifRead = async (id: string) => {
    try {
      await api.markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      );
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllNotifsRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSelectNotification = (announcementId?: string) => {
    if (announcementId) {
      const ann = announcements.find((a) => a.id === announcementId);
      if (ann) {
        setSelectedAnnouncement(ann);
        setShowNotifications(false);
      }
    }
  };

  // 1. Unauthenticated -> Render Secure Student Login View
  if (authState === 'unauthenticated') {
    return (
      <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-slate-900 font-sans">
        <LoginView onLoginSuccess={handleLoginSuccess} onToast={showToast} />
        {appToast && (
          <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl border backdrop-blur-md bg-white border-slate-200">
            <div
              className={`w-3 h-3 rounded-full shrink-0 ${
                appToast.type === 'success'
                  ? 'bg-emerald-500 ring-4 ring-emerald-100'
                  : appToast.type === 'error'
                  ? 'bg-rose-500 ring-4 ring-rose-100'
                  : 'bg-blue-500 ring-4 ring-blue-100'
              }`}
            />
            <p className="text-xs font-semibold text-slate-800 max-w-sm">{appToast.message}</p>
            <button
              type="button"
              onClick={() => setAppToast(null)}
              className="text-slate-400 hover:text-slate-600 p-1 text-xs ml-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  }

  if (authState === 'terms_required' && currentUser) {
    return (
      <TermsAndConditions
        onAccept={handleAcceptTerms}
        onDecline={handleLogout}
      />
    );
  }

  // 2. Profile Setup Required for First-Time Verified Student
  if (authState === 'profile_setup' && currentUser) {
    return (
      <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-slate-900 font-sans">
        <ProfileSetupView
          currentUser={currentUser}
          divisions={userDivisions}
          onProfileCompleted={handleProfileCompleted}
          onToast={showToast}
        />
        {appToast && (
          <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl border backdrop-blur-md bg-white border-slate-200">
            <div
              className={`w-3 h-3 rounded-full shrink-0 ${
                appToast.type === 'success'
                  ? 'bg-emerald-500 ring-4 ring-emerald-100'
                  : appToast.type === 'error'
                  ? 'bg-rose-500 ring-4 ring-rose-100'
                  : 'bg-blue-500 ring-4 ring-blue-100'
              }`}
            />
            <p className="text-xs font-semibold text-slate-800 max-w-sm">{appToast.message}</p>
            <button
              type="button"
              onClick={() => setAppToast(null)}
              className="text-slate-400 hover:text-slate-600 p-1 text-xs ml-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    );
  }

  // 3. Loading initial app data or validating session token
  if (isLoading || !currentUser || !currentInstitution) {
    return (
      <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-xs mx-auto">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center font-extrabold text-xl shadow-lg mx-auto">
            M
          </div>
          <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <div>
            <h2 className="text-sm font-bold text-slate-100">Connecting to MyCollege...</h2>
            <p className="text-xs text-slate-400 mt-1">Verifying campus security session</p>
          </div>
          {loadingDelayed && (
            <div className="pt-2 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  clearSession();
                  setAuthState('unauthenticated');
                  setIsLoading(false);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl shadow-md transition-colors cursor-pointer"
              >
                Continue to Sign In
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-[11px] text-slate-400 hover:text-slate-200 underline cursor-pointer"
              >
                Reload page
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const pendingApprovalsCount = announcements.filter((a) => a.status === 'pending_approval').length;

  return (
    <div
      className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-slate-50 text-slate-900 flex flex-col font-sans"
      style={{
        paddingBottom: 'calc(6rem + max(28px, env(safe-area-inset-bottom, 0px)))',
      }}
    >
      {/* Primary Header */}
      <Header
        currentUser={currentUser}
        institutions={institutions}
        currentInstitution={currentInstitution}
        allUsers={allUsers}
        notifications={notifications}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onSelectInstitution={handleSelectInstitution}
        onSwitchUser={handleSwitchUser}
        onOpenNotifications={handleOpenNotifications}
        onOpenProfile={handleOpenProfile}
        onGoBack={handleGoBack}
        canGoBack={activeTab !== 'home' || isChatConversationActive || !!selectedAnnouncement || showCreateModal || showNotifications || showProfile || showPreferenceSetup}
        onLogout={handleLogout}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* Primary Tab Navigation */}
    <NavigationTabs
  activeTab={activeTab}
  onTabChange={navigateToTab}
  userRole={currentUser.role}
  pendingApprovalsCount={pendingApprovalsCount}
  savedCount={savedIds.filter(id => announcements.some(a => a.id === id)).length}
  unreadChatCount={0}
/>

      <div
        role="status"
        aria-live="polite"
        className={`px-4 py-1 text-right text-[11px] font-medium ${
          realtimeStatus === 'connected'
            ? 'text-emerald-700'
            : realtimeStatus === 'offline'
              ? 'text-rose-700'
              : 'text-amber-700'
        }`}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${
            realtimeStatus === 'connected'
              ? 'bg-emerald-500'
              : realtimeStatus === 'offline'
                ? 'bg-rose-500'
                : 'bg-amber-500 animate-pulse'
          }`} />
          {realtimeStatus === 'connected' ? 'Live updates connected' : realtimeStatus === 'offline' ? 'Live updates unavailable' : 'Reconnecting to live updates…'}
        </span>
      </div>

      {/* Main View Area */}
      <main className="flex-1 min-w-0 w-full max-w-full overflow-x-hidden pb-24 sm:pb-6">
        {activeTab === 'home' && (
          <HomeView
            currentUser={currentUser}
            currentInstitution={currentInstitution}
            announcements={announcements}
            savedIds={savedIds}
            registrations={registrations}
            selectedCategory={selectedCategory}
            selectedSort={selectedSort}
            onSelectCategory={setSelectedCategory}
            onSelectSort={setSelectedSort}
            onToggleSave={handleToggleSave}
            onOpenDetails={handleOpenAnnouncement}
            onOpenExplore={() => navigateToTab('explore')}
            onOpenChat={() => navigateToTab('chat')}
            onOpenBatchDirectory={() => navigateToTab('directory')}
            onOpenDesk={() => navigateToTab('desk')}
            onQuickRegister={handleRegister}
            onOpenPreferences={currentUser.role === 'faculty' ? undefined : handleOpenPreferences}
            searchQuery={searchQuery}
          />
        )}

        {activeTab === 'explore' && (
          <ExploreView
            currentUser={currentUser}
            announcements={announcements}
            savedIds={savedIds}
            registrations={registrations}
            onToggleSave={handleToggleSave}
            onOpenDetails={handleOpenAnnouncement}
            onRegister={handleRegister}
            onCancelRegistration={handleCancelRegistration}
          />
        )}

        {activeTab === 'chat' && (
          <ChatView
            currentUser={currentUser}
            currentInstitution={currentInstitution}
            announcements={announcements}
            initialChannelId={activeChannelIdForChat}
            onOpenAnnouncement={handleOpenAnnouncement}
            onAnnouncementCreated={(newAnn) => {
              setAnnouncements((prev) => [newAnn, ...prev]);
            }}
            onOpenBatchDirectory={() => navigateToTab('directory')}
            onBack={handleGoBack}
            onConversationActiveChange={(isActive, backFn) => {
              setIsChatConversationActive(isActive);
              chatBackActionRef.current = backFn;
            }}
          />
        )}

        {activeTab === 'directory' && (
          <BatchDirectoryView
            currentUser={currentUser}
            currentInstitution={currentInstitution}
            departments={departments}
            onBack={handleGoBack}
          />
        )}

        {activeTab === 'activities' && (
          <ActivitiesView
            currentUser={currentUser}
            announcements={announcements}
            savedIds={savedIds}
            registrations={registrations}
            onToggleSave={handleToggleSave}
            onOpenDetails={handleOpenAnnouncement}
            onCancelRegistration={handleCancelRegistration}
          />
        )}

        {activeTab === 'desk' && (
          <FacultyDeskView
            currentUser={currentUser}
            currentInstitution={currentInstitution}
            announcements={announcements}
            onOpenCreate={handleOpenCreateModal}
            onOpenDetails={handleOpenAnnouncement}
            onEditAnnouncement={handleEditAnnouncement}
            onDeleteAnnouncement={handleDeleteAnnouncement}
          />
        )}

        {activeTab === 'admin' && (
          <AdminConsoleView
            currentUser={currentUser}
            currentInstitution={currentInstitution}
            announcements={announcements}
            users={allUsers}
            onApproveAnnouncement={handleApproveAnnouncement}
            onRejectAnnouncement={handleRejectAnnouncement}
            onOpenDetails={handleOpenAnnouncement}
            onRefreshData={async () => {
              await fetchAnnouncements();
              try {
                const uRes = await api.getUsers(currentInstitution.id);
                if (uRes.users) setAllUsers(uRes.users);
              } catch (e) {
                console.error('Failed to reload all users:', e);
              }
            }}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileNav
        activeTab={activeTab}
        onTabChange={navigateToTab}
        userRole={currentUser.role}
        pendingApprovalsCount={pendingApprovalsCount}
      />

      {/* Modals */}
      {selectedAnnouncement && (
        <AnnouncementModal
          announcement={selectedAnnouncement}
          currentUser={currentUser}
          isSaved={savedIds.includes(selectedAnnouncement.id)}
          registration={registrations.find((r) => r.announcementId === selectedAnnouncement.id)}
          onClose={handleCloseAnnouncement}
          onToggleSave={handleToggleSave}
          onRegister={handleRegister}
          onCancelRegistration={handleCancelRegistration}
          onOpenChat={() => {
            navigateToTab('chat');
          }}
        />
      )}

      {showCreateModal && (
        <CreateAnnouncementModal
          currentUser={currentUser}
          currentInstitution={currentInstitution}
          departments={departments}
          initialAnnouncement={editingAnnouncement || undefined}
          onClose={handleCloseCreateModal}
          onCreated={(savedAnnouncement) => {
            if (editingAnnouncement) {
              setAnnouncements((previous) =>
                previous.map((announcement) =>
                  announcement.id === savedAnnouncement.id ? savedAnnouncement : announcement
                )
              );
              return;
            }
            setAnnouncements((prev) => [savedAnnouncement, ...prev]);
            handleOpenAnnouncement(savedAnnouncement);
          }}
        />
      )}

      {showNotifications && (
        <NotificationsPopover
          currentUser={currentUser}
          notifications={notifications}
          onClose={handleCloseNotifications}
          onSelectNotification={(id) => {
            handleCloseNotifications();
            handleSelectNotification(id);
          }}
          onMarkRead={handleMarkNotifRead}
          onMarkAllRead={handleMarkAllNotifsRead}
          onOpenPreferences={currentUser.role === 'faculty' ? undefined : handleOpenPreferences}
        />
      )}

      {showProfile && (
        <UserProfileModal
          currentUser={currentUser}
          currentInstitution={currentInstitution}
          onClose={handleCloseProfile}
          onUpdateUser={setCurrentUser}
          onLogout={handleLogout}
        />
      )}

      {showPreferenceSetup && currentUser.role !== 'faculty' && (
        <PreferenceSetupModal
          currentUser={currentUser}
          onClose={handleClosePreferences}
          onSavePreferences={handleSavePreferences}
        />
      )}

      {/* Modern In-App Toast Notification Banner */}
      {appToast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl border backdrop-blur-md animate-in slide-in-from-bottom-5 duration-200 bg-white border-slate-200">
          <div
            className={`w-3 h-3 rounded-full shrink-0 ${
              appToast.type === 'success'
                ? 'bg-emerald-500 ring-4 ring-emerald-100'
                : appToast.type === 'error'
                ? 'bg-rose-500 ring-4 ring-rose-100'
                : 'bg-blue-500 ring-4 ring-blue-100'
            }`}
          />
          <p className="text-xs font-semibold text-slate-800 max-w-sm">{appToast.message}</p>
          <button
            type="button"
            onClick={() => setAppToast(null)}
            className="text-slate-400 hover:text-slate-600 p-1 text-xs ml-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
