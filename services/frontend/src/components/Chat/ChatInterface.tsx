import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';

import { chatApi, type SearchFilters, type ChatMode, type AgentEventData } from '../../api/chat';

const normalizeMode = (mode: string): ChatMode => {
    if (mode === 'agent' || mode === 'ask') return mode;
    return 'agent';
};
import { type Expert, expertApi } from '../../api/expert';
import { type SourcePaper } from './SourcePanel';
import { ExpertSelector } from './ExpertSelector';
import { ExpertAvatar } from '@/utils/expertVisuals';
import { ChatMessageItem } from './ChatMessageItem';
import { ChatInputBar } from './ChatInputBar';
import {
    normalizeSources,
    loadSavedExpertId,
    loadPersistedMessages,
} from './ChatInterface.utils';
import {
    CHAT_STORAGE_KEY,
    CHAT_SOURCES_KEY,
    CHAT_SESSION_KEY,
    TIMELINE_EVENT_TYPES,
    type Message,
    type ChatInterfaceProps,
    type ExplorationPathData,
} from './ChatInterface.types';
import styles from './ChatInterface.module.css';

const { Text, Title } = Typography;

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
    onSourcesUpdate,
    onSessionChange,
    onCreateExpert,
    onCiteClick,
}) => {
    const [input,         setInput]         = useState('');
    const [messages,      setMessages]      = useState<Message[]>(loadPersistedMessages);
    const [sources,       setSources]       = useState<SourcePaper[]>([]);
    const [loading,       setLoading]       = useState(false);
    const [chatMode,      setChatMode]      = useState<ChatMode>('agent');
    const [expertId,      setExpertId]      = useState<string | undefined>(loadSavedExpertId);
    const [currentExpert, setCurrentExpert] = useState<Expert | undefined>(undefined);
    const [sessionId,     setSessionId]     = useState<string | undefined>(() => {
        try { return localStorage.getItem(CHAT_SESSION_KEY) || undefined; }
        catch { return undefined; }
    });
    const [filters,      setFilters]      = useState<SearchFilters>({});
    const [showFilters,  setShowFilters]  = useState(false);

    const messagesEndRef    = useRef<HTMLDivElement>(null);
    const scrollAreaRef     = useRef<HTMLDivElement>(null);
    const inputRef          = useRef<any>(null);
    const hasInitialized    = useRef(false);
    const shouldScrollRef   = useRef(false);
    const userNearBottomRef = useRef(true);
    const location          = useLocation();
    const navigate          = useNavigate();

    // ── Persistence ──────────────────────────────────────────────────────────

    useEffect(() => {
        if (sessionId) localStorage.setItem(CHAT_SESSION_KEY, sessionId);
        onSessionChange?.(sessionId);
    }, [sessionId, onSessionChange]);

    useEffect(() => {
        try {
            if (expertId) localStorage.setItem('chat_expert_id', expertId);
            else          localStorage.removeItem('chat_expert_id');
        } catch { /* ignore */ }
    }, [expertId]);

    useEffect(() => {
        if (messages.length > 0) {
            try { localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages)); }
            catch { /* ignore */ }
        } else {
            localStorage.removeItem(CHAT_STORAGE_KEY);
        }
    }, [messages]);

    // ── Load expert detail ───────────────────────────────────────────────────

    useEffect(() => {
        let cancelled = false;
        if (!expertId) { setCurrentExpert(undefined); return; }
        expertApi.get(expertId)
            .then(expert => { if (!cancelled) setCurrentExpert(expert); })
            .catch(()    => { if (!cancelled) setCurrentExpert(undefined); });
        return () => { cancelled = true; };
    }, [expertId]);

    // ── Session restore on mount ──────────────────────────────────────────────

    useEffect(() => {
        const state = location.state as { fromHistory?: boolean; newSession?: boolean } | null;
        if (!state?.fromHistory && !state?.newSession && sessionId) {
            chatApi.getSession(sessionId)
                .then(session => {
                    if (!session) return;
                    setChatMode(normalizeMode(session.mode));
                    if (session.filters) setFilters(session.filters);
                    if (Array.isArray(session.messages)) {
                        setMessages(
                            session.messages.map((m: any, i: number) => ({
                                id: `restored-${i}`,
                                role: m.role,
                                content: m.content,
                                sources: Array.isArray(m.sources)
                                    ? normalizeSources(m.sources)
                                    : undefined,
                                visualizations: Array.isArray(m.visualizations)
                                    ? m.visualizations
                                    : undefined,
                                templateResults: Array.isArray(m.template_results)
                                    ? m.template_results
                                    : undefined,
                            })),
                        );
                    }
                })
                .catch(() => { /* non-fatal */ });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Smart scroll: only auto-scroll on user send, not during generation ──

    useEffect(() => {
        const el = scrollAreaRef.current;
        if (!el) return;
        const handleScroll = () => {
            const threshold = 120;
            userNearBottomRef.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
        };
        el.addEventListener('scroll', handleScroll, { passive: true });
        return () => el.removeEventListener('scroll', handleScroll);
    }, []);

    useEffect(() => {
        if (shouldScrollRef.current) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            shouldScrollRef.current = false;
        }
    }, [messages]);

    // ── Sources helper ────────────────────────────────────────────────────────

    const allSources = useMemo(() => {
        const seen = new Set<string>();
        const merged: SourcePaper[] = [];
        for (const m of messages) {
            if (!Array.isArray(m.sources)) continue;
            for (const s of m.sources) {
                if (!seen.has(s.source_id)) {
                    seen.add(s.source_id);
                    merged.push(s);
                }
            }
        }
        return merged;
    }, [messages]);

    const effectiveSources = useMemo(
        () => (allSources.length > 0 ? allSources : sources),
        [allSources, sources],
    );

    useEffect(() => {
        onSourcesUpdate(effectiveSources);
        try {
            if (effectiveSources.length > 0) localStorage.setItem(CHAT_SOURCES_KEY, JSON.stringify(effectiveSources));
            else                              localStorage.removeItem(CHAT_SOURCES_KEY);
        } catch { /* ignore */ }
    }, [effectiveSources, onSourcesUpdate]);

    const handleSourcesUpdate = useCallback((items: SourcePaper[]) => {
        const normalized = normalizeSources(items as any[]);
        setSources(normalized);
        onSourcesUpdate(normalized);
    }, [onSourcesUpdate]);


    // ── Navigation helpers ────────────────────────────────────────────────────

    const buildSourceHref = useCallback((source: SourcePaper) => {
        if (source.paper_id) return `/papers/${source.paper_id}`;
        const pathMap = {
            polymer:  '/knowledge-base/polymers',
            microbe:  '/knowledge-base/microbes',
            delivery: '/knowledge-base/delivery',
        } as const;
        return `${pathMap[source.source_type]}?search=${encodeURIComponent(source.title)}`;
    }, []);

    const navigateToSource = useCallback((source: SourcePaper) => {
        if (source.paper_id) {
            navigate(`/papers/${source.paper_id}`, {
                state: { returnTo: '/chat', returnLabel: 'Back to chat' },
            });
            return;
        }
        const pathMap = {
            polymer:  '/knowledge-base/polymers',
            microbe:  '/knowledge-base/microbes',
            delivery: '/knowledge-base/delivery',
        } as const;
        navigate(`${pathMap[source.source_type]}?search=${encodeURIComponent(source.title)}`);
    }, [navigate]);

    const handleSuggestionSelect = useCallback((question: string) => {
        setInput(question);
        inputRef.current?.focus?.();
    }, []);

    const handleExpertChange = useCallback((id: string | undefined, expert: Expert | undefined) => {
        setExpertId(id);
        setCurrentExpert(expert);
    }, []);

    // ── Session load ──────────────────────────────────────────────────────────

    const loadSession = useCallback(async (sid: string) => {
        try {
            const session = await chatApi.getSession(sid);
            if (!session) return;
            setSessionId(session.id);
            setChatMode(normalizeMode(session.mode));
            if (session.expert_id) setExpertId(session.expert_id);
            if (session.filters)   setFilters(session.filters);

            const restoredSources = Array.isArray(session.context_papers)
                ? normalizeSources(session.context_papers as any[])
                : [];

            if (Array.isArray(session.messages)) {
                setMessages(
                    session.messages.map((m: any, i: number) => {
                        const msgSources = Array.isArray(m.sources)
                            ? normalizeSources(m.sources)
                            : (m.role === 'assistant' ? restoredSources : undefined);
                        return {
                            id: `restored-${i}`,
                            role: m.role,
                            content: m.content,
                            sources: msgSources,
                            visualizations: Array.isArray(m.visualizations)
                                ? m.visualizations
                                : undefined,
                            templateResults: Array.isArray(m.template_results)
                                ? m.template_results
                                : undefined,
                        };
                    }),
                );
            }
            handleSourcesUpdate(restoredSources);
        } catch (err) {
            console.error('Failed to load session:', err);
        }
    }, [handleSourcesUpdate]);

    // ── Navigation state handler ──────────────────────────────────────────────

    useEffect(() => {
        const state = location.state as {
            initialQuery?: string;
            sessionId?: string;
            fromHistory?: boolean;
            newSession?: boolean;
        } | null;

        if (state?.newSession) {
            setMessages([]);
            setSessionId(undefined);
            setChatMode('agent');
            setFilters({});
            setExpertId(loadSavedExpertId());
            setCurrentExpert(undefined);
            handleSourcesUpdate([]);
            localStorage.removeItem(CHAT_STORAGE_KEY);
            localStorage.removeItem(CHAT_SOURCES_KEY);
            localStorage.removeItem(CHAT_SESSION_KEY);
            window.history.replaceState({}, document.title);
            if (state.initialQuery) {
                hasInitialized.current = true;
                handleSend(state.initialQuery, { historyOverride: [], sessionIdOverride: undefined });
            }
            return;
        }

        if (state?.fromHistory && state.sessionId) {
            loadSession(state.sessionId);
            window.history.replaceState({}, document.title);
            return;
        }

        if (state?.initialQuery && !hasInitialized.current) {
            hasInitialized.current = true;
            handleSend(state.initialQuery);
            window.history.replaceState({}, document.title);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.state]);

    // ── Stream helpers ────────────────────────────────────────────────────────

    const appendStreamingText = useCallback((aiMsgId: string, text: string, streaming: boolean) => {
        if (!text) return;
        setMessages(prev =>
            prev.map(m =>
                m.id === aiMsgId
                    ? { ...m, content: `${m.content || ''}${text}`, isThinking: streaming }
                    : m,
            ),
        );
    }, []);

    const handleAgentEvent = useCallback(
        (aiMsgId: string, eventData: AgentEventData) => {
            const payload = (eventData.data || {}) as Record<string, any>;

            if (eventData.type === 'session') {
                if (payload.session_id) setSessionId(payload.session_id);
                if (payload.trace_id) {
                    setMessages(prev =>
                        prev.map(m =>
                            m.id === aiMsgId
                                ? { ...m, thinkingContent: { ...(m.thinkingContent || {}), trace_id: payload.trace_id } }
                                : m,
                        ),
                    );
                }
                return;
            }

            if (eventData.type === 'thinking') {
                setMessages(prev =>
                    prev.map(m =>
                        m.id === aiMsgId
                            ? {
                                  ...m,
                                  thinkingContent: payload,
                                  agentEvents: [...(m.agentEvents || []), eventData],
                              }
                            : m,
                    ),
                );
                return;
            }

            if (eventData.type === 'sources') {
                const results = payload.results || payload;
                const normalized = normalizeSources(results as any[]);
                setMessages(prev =>
                    prev.map(m =>
                        m.id === aiMsgId
                            ? {
                                  ...m,
                                  sources: [...(m.sources || []), ...normalized.filter(
                                      ns => !(m.sources || []).some(es => es.source_id === ns.source_id),
                                  )],
                                  thinkingContent: payload.trace_id
                                      ? { ...(m.thinkingContent || {}), trace_id: payload.trace_id, source: payload.source }
                                      : m.thinkingContent,
                              }
                            : m,
                    ),
                );
                return;
            }

            if (eventData.type === 'review_outline') {
                setMessages(prev =>
                    prev.map(m => (m.id === aiMsgId ? { ...m, reviewOutline: payload } : m)),
                );
                return;
            }

            if (eventData.type === 'llm_stream') {
                const key   = payload.key   || eventData.title || 'llm_stream';
                const title = payload.title || eventData.title || key;
                const chunk = payload.chunk || '';
                const done  = !!payload.done;
                setMessages(prev =>
                    prev.map(m =>
                        m.id === aiMsgId
                            ? {
                                  ...m,
                                  llmStreams: {
                                      ...(m.llmStreams || {}),
                                      [key]: {
                                          key,
                                          title,
                                          content: `${m.llmStreams?.[key]?.content || ''}${chunk}`,
                                          done,
                                          status: eventData.status,
                                      },
                                  },
                              }
                            : m,
                    ),
                );
                return;
            }

            if ((eventData.type as string) === 'visualization') {
                setMessages(prev =>
                    prev.map(m =>
                        m.id === aiMsgId
                            ? {
                                  ...m,
                                  visualizations: [...(m.visualizations || []), payload as any],
                              }
                            : m,
                    ),
                );
                return;
            }

            if (eventData.type === 'explore_path') {
                const safeExplorePath = {
                    path: Array.isArray(payload.path) ? payload.path : [],
                    current: payload.current ?? '',
                    step: payload.step ?? 0,
                } as ExplorationPathData;
                setMessages(prev =>
                    prev.map(m => (m.id === aiMsgId ? { ...m, explorePath: safeExplorePath } : m)),
                );
                return;
            }

            if (TIMELINE_EVENT_TYPES.has(eventData.type)) {
                setMessages(prev =>
                    prev.map(m =>
                        m.id === aiMsgId
                            ? { ...m, agentEvents: [...(m.agentEvents || []), eventData] }
                            : m,
                    ),
                );
            }
        },
        [handleSourcesUpdate],
    );

    const drainStreamBuffer = useCallback(
        (aiMsgId: string, bufferInput: string, finalize = false): string => {
            let working = bufferInput;
            const marker = '__AGENT_EVENT__:';

            while (working.length > 0) {
                const markerIndex = working.indexOf(marker);

                if (markerIndex > 0) {
                    appendStreamingText(aiMsgId, working.slice(0, markerIndex), !finalize);
                    working = working.slice(markerIndex);
                    continue;
                }

                if (markerIndex === 0) {
                    const lineEnd = working.indexOf('\n');
                    if (lineEnd === -1 && !finalize) return working;

                    const eventText = (lineEnd === -1 ? working : working.slice(0, lineEnd)).trim();
                    working = lineEnd === -1 ? '' : working.slice(lineEnd + 1);

                    try {
                        const eventData: AgentEventData = JSON.parse(eventText.replace(marker, '').trim());
                        handleAgentEvent(aiMsgId, eventData);
                    } catch {
                        appendStreamingText(aiMsgId, `${eventText}\n`, !finalize);
                    }
                    continue;
                }

                const lineEnd = working.indexOf('\n');
                if (lineEnd >= 0) {
                    appendStreamingText(aiMsgId, working.slice(0, lineEnd + 1), !finalize);
                    working = working.slice(lineEnd + 1);
                    continue;
                }
                if (finalize) { appendStreamingText(aiMsgId, working, false); return ''; }

                let safeEnd = working.length;
                for (let pLen = Math.min(working.length, marker.length - 1); pLen >= 1; pLen--) {
                    if (working.endsWith(marker.slice(0, pLen))) {
                        safeEnd = working.length - pLen;
                        break;
                    }
                }
                if (safeEnd > 0) {
                    appendStreamingText(aiMsgId, working.slice(0, safeEnd), !finalize);
                }
                return working.slice(safeEnd);
            }
            return working;
        },
        [appendStreamingText, handleAgentEvent],
    );

    // ── Send ──────────────────────────────────────────────────────────────────

    const handleSend = async (
        query?: string | unknown,
        options?: { historyOverride?: Message[]; sessionIdOverride?: string | undefined },
    ) => {
        const content = (typeof query === 'string' ? query : '') || input;
        if (!content.trim() || loading) return;

        // Scroll to bottom on user send
        shouldScrollRef.current = true;

        const userMsg: Message = { id: Date.now().toString(), role: 'user', content };
        setMessages(prev => [...prev, userMsg]);
        if (!query) setInput('');
        setLoading(true);

        const historySource = options?.historyOverride ?? messages;
        const history = historySource
            .filter(m => !m.isThinking)
            .map(m => ({ role: m.role, content: m.content }));
        const sessionForRequest =
            options?.sessionIdOverride !== undefined ? options.sessionIdOverride : sessionId;
        const candidatePaperIds: string[] = Array.from(
            new Set(allSources.map(s => s.paper_id).filter((id): id is string => Boolean(id))),
        );

        const aiMsgId = (Date.now() + 1).toString();
        setMessages(prev => [
            ...prev,
            { id: aiMsgId, role: 'assistant', content: '', isThinking: true },
        ]);

        let buffer = '';
        try {
            await chatApi.completions(
                {
                    query: userMsg.content,
                    history,
                    filters: Object.keys(filters).length > 0 ? filters : undefined,
                    mode: chatMode,
                    session_id: sessionForRequest,
                    expert_id: expertId,
                    paper_ids: candidatePaperIds,
                },
                chunk => {
                    buffer += chunk;
                    buffer = drainStreamBuffer(aiMsgId, buffer, false);
                },
                (error: Error) => {
                    console.error('Chat error:', error);
                    setMessages(prev =>
                        prev.map(m =>
                            m.id === aiMsgId
                                ? { ...m, content: `${m.content || ''}\n\n[Error occurred, please retry]`, isThinking: false }
                                : m,
                        ),
                    );
                    setLoading(false);
                },
            );

            drainStreamBuffer(aiMsgId, buffer, true);
            setMessages(prev =>
                prev.map(m => (m.id === aiMsgId ? { ...m, isThinking: false } : m)),
            );
        } catch (error) {
            console.error('Request failed:', error);
        } finally {
            setLoading(false);
        }
    };

    // ── Regenerate last response ─────────────────────────────────────────────

    const handleRegenerate = useCallback(() => {
        if (loading) return;
        const lastUserIdx = [...messages].reverse().findIndex(m => m.role === 'user');
        if (lastUserIdx === -1) return;
        const idx = messages.length - 1 - lastUserIdx;
        const lastUserMsg = messages[idx];
        const kept = messages.slice(0, idx + 1);
        setMessages(kept);
        handleSend(lastUserMsg.content, { historyOverride: kept.slice(0, -1) });
    }, [loading, messages, handleSend]);

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div className={styles.container}>
            <ExpertSelector
                value={expertId}
                onChange={handleExpertChange}
                onCreateClick={onCreateExpert}
            />

            <div className={styles.messagesScrollArea} ref={scrollAreaRef}>
                <div className={styles.messagesContent}>
                    {messages.length === 0 && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                            className={styles.emptyState}
                        >
                            {currentExpert ? (
                                <>
                                    <ExpertAvatar expert={currentExpert} size={48} />
                                    <Title level={4} className={styles.emptyTitle}>{currentExpert.name}</Title>
                                    <Text className={styles.emptySubtitle}>{currentExpert.description}</Text>
                                </>
                            ) : (
                                <>
                                    <div className={styles.emptyIcon}>
                                        <RobotOutlined />
                                    </div>
                                    <Title level={4} className={styles.emptyTitle}>LiveMat Research Assistant</Title>
                                    <Text className={styles.emptySubtitle}>
                                        Ask questions about biomaterials, polymers, microorganisms, and drug delivery systems.
                                    </Text>
                                </>
                            )}
                        </motion.div>
                    )}

                    {messages.map((msg, idx) => {
                        const isLastAssistant =
                            msg.role === 'assistant' &&
                            idx === messages.length - 1;
                        return (
                            <ChatMessageItem
                                key={msg.id}
                                msg={msg}
                                allSources={effectiveSources}
                                chatMode={chatMode}
                                currentExpert={currentExpert}
                                isLastAssistant={isLastAssistant}
                                loading={loading}
                                onSuggestionSelect={handleSuggestionSelect}
                                onCiteClick={onCiteClick}
                                onNavigateToSource={navigateToSource}
                                buildSourceHref={buildSourceHref}
                                onRegenerate={handleRegenerate}
                            />
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            <ChatInputBar
                input={input}
                onInputChange={setInput}
                loading={loading}
                chatMode={chatMode}
                onModeChange={setChatMode}
                filters={filters}
                onFiltersChange={setFilters}
                showFilters={showFilters}
                onToggleFilters={() => setShowFilters(v => !v)}
                sessionId={sessionId}
                inputRef={inputRef}
                onSend={handleSend}
            />
        </div>
    );
};
