import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
    LoadingOutlined,
    CheckCircleOutlined,
    DownOutlined,
    SearchOutlined,
    FileSearchOutlined,
    EditOutlined,
    ExperimentOutlined,
    BarChartOutlined,
    WarningOutlined,
    RobotOutlined,
    BulbOutlined,
    FileTextOutlined,
    CloseCircleOutlined,
    ThunderboltOutlined,
    DatabaseOutlined,
    BookOutlined,
} from '@ant-design/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { buildUserSteps, formatToolLabel, tryParseStreamJson } from './ChatInterface.utils';
import type { Message, LlmStreamItem } from './ChatInterface.types';
import type { AgentEventData } from '../../api/chat';
import styles from './ChatInterface.module.css';

const getStepIcon = (label: string, done: boolean, failed: boolean): React.ReactNode => {
    if (failed) return <CloseCircleOutlined style={{ color: '#ef4444' }} />;
    const l = label.toLowerCase();
    if (l.includes('search') || l.includes('搜索') || l.includes('检索'))
        return <SearchOutlined style={{ color: done ? '#10b981' : '#3b82f6' }} />;
    if (l.includes('paper') || l.includes('read') || l.includes('论文'))
        return <FileTextOutlined style={{ color: done ? '#10b981' : '#8b5cf6' }} />;
    if (l.includes('writ') || l.includes('generat') || l.includes('生成') || l.includes('回答'))
        return <EditOutlined style={{ color: done ? '#10b981' : '#f59e0b' }} />;
    if (l.includes('think') || l.includes('analy') || l.includes('plan') || l.includes('分析'))
        return <BulbOutlined style={{ color: done ? '#10b981' : '#3b82f6' }} />;
    if (l.includes('review') || l.includes('综述'))
        return <FileSearchOutlined style={{ color: done ? '#10b981' : '#8b5cf6' }} />;
    if (l.includes('compar') || l.includes('对比'))
        return <ExperimentOutlined style={{ color: done ? '#10b981' : '#f59e0b' }} />;
    if (l.includes('stat') || l.includes('统计'))
        return <BarChartOutlined style={{ color: done ? '#10b981' : '#3b82f6' }} />;
    if (l.includes('delegat') || l.includes('subagent') || l.includes('子任务'))
        return <RobotOutlined style={{ color: done ? '#10b981' : '#8b5cf6' }} />;
    if (l.includes('template') || l.includes('模板'))
        return <DatabaseOutlined style={{ color: done ? '#10b981' : '#6366f1' }} />;
    if (l.includes('extract') || l.includes('提取'))
        return <FileSearchOutlined style={{ color: done ? '#10b981' : '#6366f1' }} />;
    if (l.includes('warn') || l.includes('max'))
        return <WarningOutlined style={{ color: '#f59e0b' }} />;
    if (l.includes('kb') || l.includes('知识库'))
        return <DatabaseOutlined style={{ color: done ? '#10b981' : '#3b82f6' }} />;
    return done
        ? <CheckCircleOutlined style={{ color: '#10b981' }} />
        : <ThunderboltOutlined style={{ color: '#3b82f6' }} />;
};

const ValueChips: React.FC<{ values: string[]; chipClass: string }> = ({ values, chipClass }) => (
    <div className={styles.llmChipRow}>
        {(Array.isArray(values) ? values : []).map((v, i) => (
            <span key={`${v}-${i}`} className={chipClass}>{v}</span>
        ))}
    </div>
);

interface KeywordsData {
    keywords: string[];
    alt_keywords?: string[];
    intent: string;
    kbs: string[];
    kb_labels?: string[];
    topic?: string;
}

const INTENT_LABELS: Record<string, string> = {
    search: 'Knowledge Search',
    compare: 'Comparison',
    stats: 'Statistics',
    chat: 'General Q&A',
};

const KeywordsDisplay: React.FC<{ data: KeywordsData }> = ({ data }) => (
    <motion.div
        className={styles.keywordsSection}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
    >
        <div className={styles.keywordsRow}>
            <span className={styles.keywordsLabel}>Keywords</span>
            <div className={styles.keywordsChips}>
                {data.keywords.map((kw, i) => (
                    <span key={`kw-${i}`} className={styles.keywordChip}>{kw}</span>
                ))}
            </div>
        </div>
        {data.kb_labels && data.kb_labels.length > 0 && (
            <div className={styles.keywordsRow}>
                <span className={styles.keywordsLabel}>Scope</span>
                <div className={styles.keywordsChips}>
                    {data.kb_labels.map((kb, i) => (
                        <span key={`kb-${i}`} className={styles.keywordChipKb}>{kb}</span>
                    ))}
                    <span className={styles.keywordChipIntent}>
                        {INTENT_LABELS[data.intent] || data.intent}
                    </span>
                </div>
            </div>
        )}
        {data.topic && (
            <div className={styles.keywordsRow}>
                <span className={styles.keywordsLabel}>Topic</span>
                <span className={styles.keywordsTopic}>{data.topic}</span>
            </div>
        )}
    </motion.div>
);

interface CoverageData {
    searched_kbs: string[];
    total_results: number;
    per_kb: Record<string, { count: number; label: string }>;
}

const CoverageIndicator: React.FC<{ data: CoverageData }> = ({ data }) => (
    <motion.div
        className={styles.coverageSection}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
    >
        <div className={styles.coverageHeader}>
            <BarChartOutlined className={styles.coverageIcon} />
            <span>Coverage · {data.total_results} results</span>
        </div>
        <div className={styles.coverageBars}>
            {Object.entries(data.per_kb).map(([kb, info]) => (
                <div key={kb} className={styles.coverageBar}>
                    <span className={styles.coverageBarLabel}>{info.label}</span>
                    <div className={styles.coverageBarTrack}>
                        <motion.div
                            className={styles.coverageBarFill}
                            initial={{ width: 0 }}
                            animate={{
                                width: data.total_results > 0
                                    ? `${Math.max(8, (info.count / data.total_results) * 100)}%`
                                    : '0%',
                            }}
                            transition={{ duration: 0.4, ease: 'easeOut' }}
                        />
                    </div>
                    <span className={styles.coverageBarCount}>{info.count}</span>
                </div>
            ))}
        </div>
    </motion.div>
);

const ReasoningBlock: React.FC<{ reasoning: string; step: number }> = ({ reasoning, step }) => (
    <motion.div
        className={styles.reasoningBlock}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
    >
        <div className={styles.reasoningLabel}>
            <BookOutlined style={{ marginRight: 4 }} />
            Thought · Step {step}
        </div>
        <div className={styles.reasoningText}>{reasoning}</div>
    </motion.div>
);

const StructuredLlmStream: React.FC<{ item: LlmStreamItem }> = ({ item }) => {
    const parsed = item.done ? tryParseStreamJson(item.content) : null;
    if (!parsed) return <div className={styles.llmStreamContent}>{item.content}</div>;

    if (item.key === 'query_analyzer') {
        const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.filter(Boolean) : [];
        return (
            <div className={styles.llmStructuredBlock}>
                {keywords.length > 0 && (
                    <div className={styles.llmField}>
                        <div className={styles.llmFieldLabel}>Key Concepts</div>
                        <ValueChips values={keywords} chipClass={styles.llmKeywordChip} />
                    </div>
                )}
                {parsed.intent_type && (
                    <div className={styles.llmField}>
                        <div className={styles.llmFieldLabel}>Intent</div>
                        <div className={styles.llmFieldText}>{parsed.intent_type}</div>
                    </div>
                )}
            </div>
        );
    }

    if (item.key === 'filter_extractor') {
        const filters = parsed.filters && typeof parsed.filters === 'object' ? parsed.filters : {};
        const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.filter(Boolean) : [];
        const entries = Object.entries(filters).filter(([, v]) =>
            Array.isArray(v) ? (v as any[]).length > 0 : Boolean(v),
        );
        return (
            <div className={styles.llmStructuredBlock}>
                {entries.length > 0 && (
                    <div className={styles.llmField}>
                        <div className={styles.llmFieldLabel}>Filters</div>
                        <div className={styles.llmFieldList}>
                            {entries.map(([name, value]) => (
                                <div key={name} className={styles.llmFieldListItem}>
                                    <span className={styles.llmFieldName}>{name}</span>
                                    <span className={styles.llmFieldValue}>
                                        {Array.isArray(value) ? (value as string[]).join(', ') : String(value)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {keywords.length > 0 && (
                    <div className={styles.llmField}>
                        <div className={styles.llmFieldLabel}>Search Terms</div>
                        <ValueChips values={keywords} chipClass={styles.llmKeywordChip} />
                    </div>
                )}
            </div>
        );
    }

    if (item.key === 'query_expander') {
        const queries = Array.isArray(parsed.queries) ? parsed.queries.filter(Boolean) : [];
        return (
            <div className={styles.llmStructuredBlock}>
                <div className={styles.llmField}>
                    <div className={styles.llmFieldLabel}>Search Directions</div>
                    <div className={styles.llmNumberedList}>
                        {queries.map((v: string, i: number) => (
                            <div key={`${v}-${i}`} className={styles.llmNumberedItem}>
                                <span className={styles.llmNumberedIndex}>{i + 1}</span>
                                <span className={styles.llmNumberedText}>{v}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (item.key === 'query_translator') {
        const translations = Array.isArray(parsed.translations) ? parsed.translations.filter(Boolean) : [];
        return (
            <div className={styles.llmStructuredBlock}>
                {translations.length > 0 && (
                    <div className={styles.llmField}>
                        <div className={styles.llmFieldLabel}>English Terms</div>
                        <ValueChips values={translations} chipClass={styles.llmTranslationChip} />
                    </div>
                )}
                {parsed.query && (
                    <div className={styles.llmField}>
                        <div className={styles.llmFieldLabel}>English Query</div>
                        <div className={styles.llmFieldText}>{parsed.query}</div>
                    </div>
                )}
            </div>
        );
    }

    return <div className={styles.llmStreamContent}>{item.content}</div>;
};

interface ThinkingProcessProps {
    msg: Message;
    isStreaming: boolean;
}

const EMPTY_EVENTS: AgentEventData[] = [];

export const ThinkingProcess: React.FC<ThinkingProcessProps> = ({ msg, isStreaming }) => {
    const [expanded, setExpanded] = useState(true);
    const prevStreamingRef = useRef(isStreaming);
    const stepsEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (prevStreamingRef.current && !isStreaming) {
            const timer = setTimeout(() => setExpanded(false), 800);
            return () => clearTimeout(timer);
        }
        if (isStreaming) setExpanded(true);
        prevStreamingRef.current = isStreaming;
    }, [isStreaming]);

    useEffect(() => {
        if (isStreaming && expanded && stepsEndRef.current) {
            stepsEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [msg.agentEvents?.length, isStreaming, expanded]);

    const hasThinking = !!msg.thinkingContent;
    const events = msg.agentEvents ?? EMPTY_EVENTS;
    const hasAgent = events.length > 0;
    const llmStreams: LlmStreamItem[] = useMemo(
        () => (Object.values(msg.llmStreams || {}) as LlmStreamItem[])
            .filter(item => Boolean(item && (item.content || item.done))),
        [msg.llmStreams],
    );

    const keywordsEvent = useMemo(() => {
        const ev = events.find((e: AgentEventData) => e.type === 'keywords');
        return ev?.data as KeywordsData | undefined;
    }, [events]);

    const coverageEvent = useMemo(() => {
        const ev = events.find((e: AgentEventData) => e.type === 'coverage');
        return ev?.data as CoverageData | undefined;
    }, [events]);

    // Extract all reasoning events from the thinking content
    const reasoningBlocks = useMemo(() => {
        const blocks: Array<{ reasoning: string; step: number }> = [];
        if (msg.thinkingContent?.reasoning) {
            blocks.push({
                reasoning: msg.thinkingContent.reasoning,
                step: msg.thinkingContent.step || 1,
            });
        }
        for (const ev of events) {
            if (ev.type === 'thinking' && ev.data?.reasoning) {
                blocks.push({
                    reasoning: ev.data.reasoning,
                    step: ev.data.step || blocks.length + 1,
                });
            }
        }
        // Deduplicate by step number
        const seen = new Set<number>();
        return blocks.filter(b => {
            if (seen.has(b.step)) return false;
            seen.add(b.step);
            return true;
        });
    }, [msg.thinkingContent, events]);

    const userSteps = useMemo(() => buildUserSteps(msg), [msg]);
    const doneCount = userSteps.filter(s => s.done).length;
    const failedCount = userSteps.filter(s => s.detail?.includes('错误') || s.detail?.includes('失败')).length;
    const activeStep = userSteps.find(s => !s.done);
    const totalSteps = userSteps.length;

    if (!hasThinking && !hasAgent && llmStreams.length === 0 && reasoningBlocks.length === 0) return null;

    const headerLabel = isStreaming
        ? activeStep?.label
            ? activeStep.label
            : doneCount > 0
                ? `Completed ${doneCount} steps, working...`
                : 'Thinking...'
        : failedCount > 0
            ? `Done (${failedCount} errors)`
            : `${doneCount} steps completed`;

    return (
        <div className={styles.thinkingProcess}>
            <button
                className={`${styles.thinkingToggle} ${isStreaming ? styles.thinkingStreaming : ''}`}
                onClick={() => setExpanded(e => !e)}
            >
                <span className={styles.thinkingToggleIcon}>
                    {isStreaming ? (
                        <span className={styles.pulsingDot} />
                    ) : failedCount > 0 ? (
                        <WarningOutlined style={{ color: '#f59e0b' }} />
                    ) : (
                        <CheckCircleOutlined style={{ color: '#10b981' }} />
                    )}
                </span>
                <span className={styles.thinkingToggleLabel}>
                    {headerLabel}
                </span>
                {totalSteps > 0 && !isStreaming && (
                    <span className={styles.thinkingStepCount}>
                        {totalSteps}
                    </span>
                )}
                <DownOutlined
                    className={`${styles.thinkingChevron} ${expanded ? styles.thinkingChevronOpen : ''}`}
                />
            </button>

            <AnimatePresence initial={false}>
                {expanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        style={{ overflow: 'hidden' }}
                    >
                        <div className={styles.thinkingBody}>
                            {keywordsEvent && <KeywordsDisplay data={keywordsEvent} />}

                            <div className={styles.thinkingSteps}>
                                {userSteps.map((step, i) => {
                                    const isFailed = step.detail?.includes('错误') || step.detail?.includes('失败');
                                    const isActive = !step.done && isStreaming;
                                    const icon = getStepIcon(step.label, step.done, !!isFailed);

                                    const matchingReasoning = reasoningBlocks.find(r => r.step === i + 1);

                                    return (
                                        <React.Fragment key={`step-${i}`}>
                                            {matchingReasoning && (
                                                <ReasoningBlock
                                                    reasoning={matchingReasoning.reasoning}
                                                    step={matchingReasoning.step}
                                                />
                                            )}
                                            <motion.div
                                                initial={{ opacity: 0, x: -4 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ delay: Math.min(i * 0.03, 0.15) }}
                                                className={`${styles.thinkingStep} ${isActive ? styles.thinkingStepActive : ''}`}
                                            >
                                                <span
                                                    className={`${styles.stepDot} ${
                                                        step.done
                                                            ? isFailed
                                                                ? styles.stepDotFailed
                                                                : styles.stepDotDone
                                                            : isActive
                                                                ? styles.stepDotActive
                                                                : ''
                                                    }`}
                                                >
                                                    {isActive ? <LoadingOutlined /> : icon}
                                                </span>
                                                <div className={styles.stepContent}>
                                                    <span className={styles.stepLabel}>{step.label}</span>
                                                    {step.detail && (
                                                        <span className={`${styles.stepDetail} ${
                                                            isFailed ? styles.stepDetailFailed : ''
                                                        }`}>
                                                            {step.detail}
                                                        </span>
                                                    )}
                                                </div>
                                            </motion.div>
                                        </React.Fragment>
                                    );
                                })}

                                {/* Show reasoning blocks that don't have a matching step */}
                                {reasoningBlocks
                                    .filter(r => r.step > userSteps.length)
                                    .map((r) => (
                                        <ReasoningBlock
                                            key={`reasoning-${r.step}`}
                                            reasoning={r.reasoning}
                                            step={r.step}
                                        />
                                    ))}

                                <div ref={stepsEndRef} />
                            </div>

                            {coverageEvent && <CoverageIndicator data={coverageEvent} />}

                            {llmStreams.length > 0 && (
                                <div className={styles.llmStreamList}>
                                    {llmStreams.map((item, index) => (
                                        <div key={`${item.title}-${index}`} className={styles.llmStreamCard}>
                                            <div className={styles.llmStreamHeader}>
                                                <span className={styles.llmStreamTitle}>
                                                    {formatToolLabel(item.key, item.title)}
                                                </span>
                                                <span className={styles.llmStreamStatus}>
                                                    {item.done ? 'done' : 'streaming'}
                                                </span>
                                            </div>
                                            <StructuredLlmStream item={item} />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};
