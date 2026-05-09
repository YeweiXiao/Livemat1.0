import React, { useState, useCallback } from 'react';
import { Avatar, Card, Spin, Tooltip, Typography } from 'antd';
import {
    BulbOutlined,
    CheckOutlined,
    CopyOutlined,
    FileTextOutlined,
    ReloadOutlined,
    RobotOutlined,
    UserOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ThinkingProcess } from './ThinkingProcess';
import {
    parseSuggestions,
    parseVisualizationBlocks,
    processMessageContent,
} from './ChatInterface.utils';
import type { Message, AtpsVisualizationPayload, ExplorationPathData } from './ChatInterface.types';
import type { SourcePaper } from './SourcePanel';
import type { ChatMode } from '../../api/chat';
import type { Expert } from '../../api/expert';
import { ExpertAvatar } from '@/utils/expertVisuals';
import { PhaseDiagramCard } from './PhaseDiagramCard';
import { TemplateCreatedCard, ExtractionResultCard } from './TemplateCards';
import styles from './ChatInterface.module.css';

const { Text, Title } = Typography;

const AtpsVisualizationCard: React.FC<{ payload: AtpsVisualizationPayload }> = ({ payload }) => {
    const parameters = payload.parameters || {};
    return (
        <Card size="small" className={styles.visualizationCard}>
            <div className={styles.visualizationHeader}>
                <Text strong>{payload.title || 'ATPS Phase Diagram'}</Text>
                <Text type="secondary">
                    {payload.mode === 'points' ? 'Experimental Points' : 'Merchuk Parameters'}
                </Text>
            </div>
            {payload.image_url && (
                <div className={styles.visualizationImageWrap}>
                    <img
                        src={payload.image_url}
                        alt={payload.title || 'ATPS visualization'}
                        className={styles.visualizationImage}
                    />
                </div>
            )}
            <div className={styles.visualizationMeta}>
                <span>Points: {payload.point_count || 0}</span>
                {payload.mode === 'merchuk' && (
                    <>
                        <span>a={typeof parameters.a === 'number' ? parameters.a.toFixed(3) : '-'}</span>
                        <span>b={typeof parameters.b === 'number' ? parameters.b.toFixed(3) : '-'}</span>
                        <span>c={typeof parameters.c === 'number' ? parameters.c.toFixed(4) : '-'}</span>
                        <span>
                            T={typeof parameters.temperature === 'number' ? parameters.temperature.toFixed(1) : '-'}°C
                        </span>
                    </>
                )}
            </div>
        </Card>
    );
};

const ReviewOutline: React.FC<{ outline: any }> = ({ outline }) => {
    if (!outline) return null;
    return (
        <Card size="small" className={styles.outlineCard}>
            <div className={styles.outlineHeader}>
                <FileTextOutlined style={{ marginRight: 8 }} />
                <Text strong>Review Outline</Text>
            </div>
            {outline.title && (
                <Title level={5} style={{ marginTop: 12, marginBottom: 12 }}>
                    {outline.title}
                </Title>
            )}
            {Array.isArray(outline.sections) && outline.sections.length > 0 && (
                <div className={styles.outlineSections}>
                    {outline.sections.map((section: any, index: number) => (
                        <div key={index} className={styles.outlineSection}>
                            <div className={styles.sectionTitle}>
                                <Text strong>
                                    {index + 1}. {section.title}
                                </Text>
                                {section.relevant_papers && (
                                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
                                        ({section.relevant_papers.length} papers)
                                    </Text>
                                )}
                            </div>
                            {Array.isArray(section.subsections) && section.subsections.length > 0 && (
                                <div className={styles.subsections}>
                                    {section.subsections.map((sub: string, subIdx: number) => (
                                        <div key={subIdx} className={styles.subsection}>
                                            <Text type="secondary">
                                                {index + 1}.{subIdx + 1} {sub}
                                            </Text>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
};

const ExplorationBreadcrumbs: React.FC<{ explorePath: ExplorationPathData }> = ({
    explorePath,
}) => {
    if (!explorePath || explorePath.step <= 1 || !Array.isArray(explorePath.path)) return null;
    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={styles.explorationPath}
        >
            <div className={styles.pathHeader}>
                <Text type="secondary">Exploration · Step {explorePath.step}</Text>
            </div>
            <div className={styles.pathBreadcrumbs}>
                {explorePath.path.map((step, index) => (
                    <React.Fragment key={index}>
                        <span className={styles.pathStep}>
                            {step.query.length > 20 ? step.query.slice(0, 20) + '...' : step.query}
                        </span>
                        <span className={styles.pathArrow}>→</span>
                    </React.Fragment>
                ))}
                <span className={styles.pathCurrent}>{explorePath.current}</span>
            </div>
        </motion.div>
    );
};

const SuggestionChips: React.FC<{
    suggestions: string[];
    onSelect: (q: string) => void;
}> = ({ suggestions, onSelect }) => {
    if (suggestions.length === 0) return null;
    return (
        <div className={styles.suggestionsContainer}>
            <div className={styles.suggestionsHeader}>
                <BulbOutlined className={styles.suggestionsIcon} />
                <span>Related questions</span>
            </div>
            <div className={styles.suggestionsChips}>
                <AnimatePresence>
                    {suggestions.map((suggestion, index) => (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ delay: index * 0.08, duration: 0.25 }}
                        >
                            <Tooltip title="Click to ask" placement="top">
                                <button
                                    className={styles.suggestionChip}
                                    onClick={() => onSelect(suggestion)}
                                >
                                    <span className={styles.suggestionNumber}>
                                        {index + 1}
                                    </span>
                                    <span className={styles.suggestionText}>{suggestion}</span>
                                    <span className={styles.suggestionArrow}>→</span>
                                </button>
                            </Tooltip>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
};

export interface ChatMessageItemProps {
    msg: Message;
    allSources?: SourcePaper[];
    chatMode?: ChatMode;
    currentExpert?: Expert;
    isLastAssistant?: boolean;
    loading?: boolean;
    onSuggestionSelect: (question: string) => void;
    onCiteClick?: (sourceId: string) => void;
    onNavigateToSource: (source: SourcePaper) => void;
    buildSourceHref: (source: SourcePaper) => string;
    onRegenerate?: () => void;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({
    msg,
    allSources,
    currentExpert,
    isLastAssistant,
    loading,
    onSuggestionSelect,
    onCiteClick,
    onNavigateToSource,
    buildSourceHref,
    onRegenerate,
}) => {
    const navigate = useNavigate();
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(() => {
        if (!msg.content) return;
        navigator.clipboard.writeText(msg.content).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    }, [msg.content]);

    const messageSources =
        Array.isArray(msg.sources) && msg.sources.length > 0 ? msg.sources : [];

    const templateCards = React.useMemo(() => {
        if (msg.role !== 'assistant') return { created: [], extracted: [] };
        const created: any[] = [];
        const extracted: any[] = [];

        const processEntry = (meta: Record<string, any>) => {
            if (meta.template_id && meta.field_count != null) {
                created.push({
                    template_id: meta.template_id,
                    template_name: meta.template_name || 'Template',
                    field_count: meta.field_count,
                    fields: meta.fields || [],
                });
            }
            if (meta.template_name && Array.isArray(meta.results)) {
                extracted.push({
                    template_name: meta.template_name,
                    results: meta.results,
                });
            }
        };

        if (msg.agentEvents) {
            for (const ev of msg.agentEvents) {
                if (ev.type !== 'tool_result') continue;
                const evData = (ev as any).data || {};
                const meta = (evData.result || {}).metadata || {};
                processEntry(meta);
            }
        }

        if (msg.templateResults) {
            for (const tr of msg.templateResults) {
                processEntry(tr);
            }
        }

        return { created, extracted };
    }, [msg.role, msg.agentEvents, msg.templateResults]);

    const renderBody = () => {
        if (!msg.content && !msg.isThinking) return null;

        const { mainContent, suggestions } =
            msg.role === 'assistant' && msg.content
                ? parseSuggestions(msg.content)
                : { mainContent: msg.content, suggestions: [] as string[] };

        const { content: cleanContent, visualizations } =
            msg.role === 'assistant'
                ? parseVisualizationBlocks(mainContent)
                : { content: mainContent, visualizations: [] };

        const processed = processMessageContent(cleanContent, messageSources, allSources);

        // Collect which sources are actually cited inline
        const citedIds = new Set<string>();
        const citeRe = /#cite\/([a-f0-9-]+)/g;
        let citeMatch;
        while ((citeMatch = citeRe.exec(processed)) !== null) {
            citedIds.add(citeMatch[1]);
        }

        // Build the source index map (all sources, matching the numbering used by processMessageContent)
        const pool = allSources && allSources.length > 0 ? allSources : messageSources;
        const sourceIndexMap = new Map<string, number>();
        pool.forEach((s, idx) => {
            const n = idx + 1;
            sourceIndexMap.set(s.source_id, n);
            if (s.paper_id) sourceIndexMap.set(s.paper_id, n);
        });

        // Determine which sources to show in the references footer
        // Prioritize sources that have a paper_id (actual papers, not just KB records)
        const referencedSources: Array<{ source: SourcePaper; index: number }> = [];
        const seen = new Set<string>();

        if (citedIds.size > 0) {
            for (const id of citedIds) {
                const src = messageSources.find(s => s.source_id === id || s.paper_id === id);
                if (!src) continue;
                const key = src.paper_id || src.source_id;
                if (seen.has(key)) continue;
                seen.add(key);
                referencedSources.push({
                    source: src,
                    index: sourceIndexMap.get(src.source_id) ?? sourceIndexMap.get(src.paper_id ?? '') ?? referencedSources.length + 1,
                });
            }
        } else {
            // No inline citations — show sources that have paper_id (skip KB-only)
            for (const source of messageSources) {
                const key = source.paper_id || source.source_id;
                if (seen.has(key)) continue;
                seen.add(key);
                referencedSources.push({ source, index: referencedSources.length + 1 });
            }
        }

        return (
            <>
                <div className={msg.role === 'user' ? styles.userMessage : styles.assistantMessage}>
                    {msg.isThinking && !msg.content ? (
                        <Spin size="small" />
                    ) : (
                        <div className={styles.messageText}>
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    p: ({ node: _node, ...props }) => <p {...props} />,
                                    a: ({ node: _node, href, children, ...props }) => {
                                        if (href?.startsWith('#cite/')) {
                                            const refId = href.replace('#cite/', '');
                                            const src = messageSources.find(
                                                s => s.source_id === refId || s.paper_id === refId,
                                            );
                                            const n = sourceIndexMap.get(refId);
                                            const tooltipContent = src
                                                ? (
                                                    <div style={{ maxWidth: 360 }}>
                                                        <div style={{ fontWeight: 600, marginBottom: 4, lineHeight: 1.3 }}>{src.title}</div>
                                                        {(src.authors?.length || src.journal || src.year) && (
                                                            <div style={{ fontSize: 11, opacity: 0.85 }}>
                                                                {src.authors?.slice(0, 3).join(', ')}
                                                                {src.journal && ` · ${src.journal}`}
                                                                {src.year && ` (${src.year})`}
                                                            </div>
                                                        )}
                                                        {src.paper_id && (
                                                            <div style={{ fontSize: 10, marginTop: 4, opacity: 0.65 }}>
                                                                Click to view paper
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                                : refId.slice(0, 8);
                                            return (
                                                <Tooltip title={tooltipContent} placement="top" overlayStyle={{ maxWidth: 400 }}>
                                                    <a
                                                        {...props}
                                                        href={href}
                                                        onClick={e => {
                                                            e.preventDefault();
                                                            if (src?.paper_id) {
                                                                navigate(`/papers/${src.paper_id}`, {
                                                                    state: { returnTo: '/chat', returnLabel: 'Back to chat' },
                                                                });
                                                            } else {
                                                                onCiteClick?.(refId);
                                                            }
                                                        }}
                                                        className={styles.citeBadge}
                                                    >
                                                        {n ?? children}
                                                    </a>
                                                </Tooltip>
                                            );
                                        }
                                        if (href?.startsWith('/papers/')) {
                                            return (
                                                <a
                                                    {...props}
                                                    href={href}
                                                    onClick={e => {
                                                        e.preventDefault();
                                                        navigate(href, {
                                                            state: { returnTo: '/chat', returnLabel: 'Back to chat' },
                                                        });
                                                    }}
                                                    className={styles.paperLink}
                                                >
                                                    {children}
                                                </a>
                                            );
                                        }
                                        return <a {...props} href={href}>{children}</a>;
                                    },
                                }}
                            >
                                {processed}
                            </ReactMarkdown>

                            {msg.role === 'assistant' &&
                                visualizations.map((viz, index) => (
                                    <React.Fragment key={`parsed-viz-${viz.type}-${index}`}>
                                        {viz.type === 'atps_phase_diagram' && (
                                            <AtpsVisualizationCard payload={viz as AtpsVisualizationPayload} />
                                        )}
                                        {viz.type === 'phase_diagram' && (
                                            <PhaseDiagramCard payload={viz as any} />
                                        )}
                                    </React.Fragment>
                                ))}

                            {msg.role === 'assistant' &&
                                (msg.visualizations || []).map((viz, index) => (
                                    <React.Fragment key={`event-viz-${viz.type}-${index}`}>
                                        {viz.type === 'phase_diagram' && (
                                            <PhaseDiagramCard payload={viz as any} />
                                        )}
                                        {viz.type === 'atps_phase_diagram' && (
                                            <AtpsVisualizationCard payload={viz as AtpsVisualizationPayload} />
                                        )}
                                    </React.Fragment>
                                ))}

                            {templateCards.created.map((tc, i) => (
                                <TemplateCreatedCard key={`tpl-${i}`} data={tc} />
                            ))}
                            {templateCards.extracted.map((ex, i) => (
                                <ExtractionResultCard key={`ext-${i}`} data={ex} />
                            ))}

                            {msg.role === 'assistant' &&
                                referencedSources.length > 0 &&
                                !msg.isThinking && (
                                    <div className={styles.inlineSourcesBlock}>
                                        <div className={styles.inlineSourcesTitle}>
                                            References ({referencedSources.length})
                                        </div>
                                        <div className={styles.inlineSourcesList}>
                                            {referencedSources.map(({ source, index }) => (
                                                <a
                                                    key={`${source.source_id}-${index}`}
                                                    href={source.paper_id ? `/papers/${source.paper_id}` : buildSourceHref(source)}
                                                    className={styles.inlineSourceLink}
                                                    onClick={e => {
                                                        e.preventDefault();
                                                        if (source.paper_id) {
                                                            navigate(`/papers/${source.paper_id}`, {
                                                                state: { returnTo: '/chat', returnLabel: 'Back to chat' },
                                                            });
                                                        } else {
                                                            onNavigateToSource(source);
                                                        }
                                                    }}
                                                >
                                                    <span className={styles.inlineSourceIndex}>{index}</span>
                                                    <span className={styles.inlineSourceInfo}>
                                                        <span className={styles.inlineSourceName}>{source.title}</span>
                                                        {(source.authors?.length || source.journal || source.year) && (
                                                            <span className={styles.inlineSourceMeta}>
                                                                {source.authors?.slice(0, 2).join(', ')}
                                                                {source.journal && ` · ${source.journal}`}
                                                                {source.year && ` (${source.year})`}
                                                            </span>
                                                        )}
                                                    </span>
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                )}
                        </div>
                    )}
                </div>

                {msg.role === 'assistant' && suggestions.length > 0 && (
                    <SuggestionChips
                        suggestions={suggestions}
                        onSelect={onSuggestionSelect}
                    />
                )}
            </>
        );
    };

    return (
        <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className={`${styles.messageWrapper} ${msg.role === 'user' ? styles.user : ''}`}
        >
            {msg.role === 'assistant' && (
                currentExpert ? (
                    <ExpertAvatar
                        expert={currentExpert}
                        className={`${styles.avatar} ${styles.assistant}`}
                        size={28}
                    />
                ) : (
                    <Avatar
                        icon={<RobotOutlined />}
                        className={`${styles.avatar} ${styles.assistant}`}
                    />
                )
            )}

            <div className={styles.messageContent}>
                <ThinkingProcess msg={msg} isStreaming={!!msg.isThinking} />

                {msg.reviewOutline && <ReviewOutline outline={msg.reviewOutline} />}

                {msg.explorePath && <ExplorationBreadcrumbs explorePath={msg.explorePath} />}

                {renderBody()}

                {msg.content && !msg.isThinking && (
                    <div className={styles.msgActions}>
                        <Tooltip title={copied ? 'Copied' : 'Copy'}>
                            <button className={styles.msgActionBtn} onClick={handleCopy}>
                                {copied ? <CheckOutlined /> : <CopyOutlined />}
                            </button>
                        </Tooltip>
                        {msg.role === 'assistant' && isLastAssistant && onRegenerate && (
                            <Tooltip title="Regenerate">
                                <button
                                    className={styles.msgActionBtn}
                                    onClick={onRegenerate}
                                    disabled={loading}
                                >
                                    <ReloadOutlined />
                                </button>
                            </Tooltip>
                        )}
                    </div>
                )}
            </div>

            {msg.role === 'user' && (
                <Avatar
                    icon={<UserOutlined />}
                    className={`${styles.avatar} ${styles.user}`}
                />
            )}
        </motion.div>
    );
};
