import React, { useState, useEffect, useCallback } from 'react';
import { Spin, Popconfirm, message } from 'antd';
import {
    PlusOutlined,
    MessageOutlined,
    DeleteOutlined,
    SearchOutlined,
} from '@ant-design/icons';
import { chatApi, ChatSession, ChatMode } from '../../api/chat';
import styles from './SessionSidebar.module.css';

interface SessionSidebarProps {
    currentSessionId?: string;
    onSessionSelect: (session: ChatSession) => void;
    onNewSession: () => void;
}

const modeLabels: Record<ChatMode, string> = {
    agent: 'Agent',
    ask: 'Ask',
};

export const SessionSidebar: React.FC<SessionSidebarProps> = ({
    currentSessionId,
    onSessionSelect,
    onNewSession,
}) => {
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [loading, setLoading] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const loadSessions = useCallback(async () => {
        setLoading(true);
        try {
            const list = await chatApi.listSessions(50);
            setSessions(list);
        } catch (err) {
            console.error('Failed to load sessions:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadSessions();
    }, [loadSessions]);

    useEffect(() => {
        if (currentSessionId) {
            loadSessions();
        }
    }, [currentSessionId, loadSessions]);

    // Keyboard shortcut: Ctrl/Cmd + Shift + O = new session
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'o') {
                e.preventDefault();
                onNewSession();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onNewSession]);

    const formatTime = (isoString?: string) => {
        if (!isoString) return '';
        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const handleDeleteSession = async (session: ChatSession) => {
        if (deletingId) return;
        setDeletingId(session.id);
        try {
            await chatApi.deleteSession(session.id);
            setSessions((prev) => prev.filter((item) => item.id !== session.id));
            message.success('Session deleted');
            if (session.id === currentSessionId) {
                onNewSession();
            }
        } catch (err) {
            console.error('Failed to delete session:', err);
            message.error('Failed to delete session');
        } finally {
            setDeletingId(null);
        }
    };

    const getSessionTitle = (session: ChatSession) => {
        if (session.title) return session.title;
        if (session.preview) return session.preview;
        return modeLabels[session.mode] || 'New chat';
    };

    const filteredSessions = searchQuery
        ? sessions.filter((s) => {
              const q = searchQuery.toLowerCase();
              const title = getSessionTitle(s).toLowerCase();
              const preview = s.preview?.toLowerCase() || '';
              return title.includes(q) || preview.includes(q);
          })
        : sessions;

    // Group sessions by time
    const groupSessions = (sessions: ChatSession[]) => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today.getTime() - 86400000);
        const weekAgo = new Date(today.getTime() - 7 * 86400000);

        const groups: { label: string; items: ChatSession[] }[] = [
            { label: 'Today', items: [] },
            { label: 'Yesterday', items: [] },
            { label: 'This week', items: [] },
            { label: 'Earlier', items: [] },
        ];

        for (const s of sessions) {
            const d = new Date(s.updated_time || s.created_time || '');
            if (d >= today) groups[0].items.push(s);
            else if (d >= yesterday) groups[1].items.push(s);
            else if (d >= weekAgo) groups[2].items.push(s);
            else groups[3].items.push(s);
        }

        return groups.filter((g) => g.items.length > 0);
    };

    const grouped = groupSessions(filteredSessions);

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <span className={styles.title}>History</span>
                <button
                    className={styles.newChatBtn}
                    onClick={onNewSession}
                    title="New chat (Ctrl+Shift+O)"
                >
                    <PlusOutlined />
                </button>
            </div>

            {sessions.length > 5 && (
                <div className={styles.searchBox}>
                    <SearchOutlined className={styles.searchIcon} />
                    <input
                        className={styles.searchInput}
                        placeholder="Search sessions..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            )}

            <div className={styles.sessionList}>
                {loading ? (
                    <div className={styles.loading}>
                        <Spin size="small" />
                    </div>
                ) : filteredSessions.length === 0 ? (
                    <div className={styles.emptyState}>
                        <MessageOutlined className={styles.emptyIcon} />
                        <div className={styles.emptyText}>
                            {searchQuery ? 'No matching sessions' : 'No conversations yet'}
                        </div>
                    </div>
                ) : (
                    grouped.map((group) => (
                        <div key={group.label} className={styles.group}>
                            <div className={styles.groupLabel}>{group.label}</div>
                            {group.items.map((session) => (
                                <div
                                    key={session.id}
                                    className={`${styles.sessionItem} ${session.id === currentSessionId ? styles.active : ''}`}
                                    onClick={() => onSessionSelect(session)}
                                >
                                    <div className={styles.sessionContent}>
                                        <div className={styles.sessionTitle}>
                                            {getSessionTitle(session)}
                                        </div>
                                        <div className={styles.sessionMeta}>
                                            <span className={styles.modeTag}>
                                                {modeLabels[session.mode as ChatMode] || session.mode}
                                            </span>
                                            {(session.message_count ?? 0) > 0 && (
                                                <span className={styles.msgCount}>
                                                    {session.message_count} msgs
                                                </span>
                                            )}
                                            <span className={styles.time}>
                                                {formatTime(session.updated_time)}
                                            </span>
                                        </div>
                                    </div>
                                    <Popconfirm
                                        title="Delete this session?"
                                        description="This cannot be undone."
                                        okText="Delete"
                                        cancelText="Cancel"
                                        okButtonProps={{
                                            danger: true,
                                            loading: deletingId === session.id,
                                        }}
                                        onConfirm={(e) => {
                                            e?.stopPropagation();
                                            return handleDeleteSession(session);
                                        }}
                                        onPopupClick={(e) => e.stopPropagation()}
                                    >
                                        <button
                                            className={styles.deleteBtn}
                                            onClick={(e) => e.stopPropagation()}
                                            aria-label="Delete session"
                                        >
                                            <DeleteOutlined />
                                        </button>
                                    </Popconfirm>
                                </div>
                            ))}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
