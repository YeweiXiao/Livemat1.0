import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Input, Button, Tag, Space, Typography, Card, Steps } from 'antd';
import {
    SendOutlined,
    RobotOutlined,
    UserOutlined,
    CheckOutlined,
    BugOutlined,
    ExperimentOutlined,
    FileSearchOutlined,
    HeatMapOutlined,
    RocketOutlined,
} from '@ant-design/icons';
import { Avatar } from 'antd';
import { ExpertCreate, expertApi } from '../../api/expert';
import { EXPERT_AVATAR_PRESETS, ExpertAvatar } from '@/utils/expertVisuals';
import styles from './ExpertCreation.module.css';

const { Text, Title } = Typography;

interface ExpertCreationProps {
    onComplete: (expertId: string) => void;
    onCancel: () => void;
}

interface ChatMsg {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

interface CreationState {
    step: number;
    name: string;
    avatar: string;
    domain: string;
    capabilities: string[];
    description: string;
    systemPrompt: string;
    knowledgeBases: string[];
}

const STEPS = [
    { id: 'name', question: '你好！让我们一起创建一位领域专家。首先，给专家起个名字吧？' },
    { id: 'domain', question: '很好！{name} 是个不错的名字。请选择或输入专业领域：' },
    { id: 'kb', question: '了解！请选择 {name} 可以访问的知识库（可多选）：' },
    { id: 'capabilities', question: '接下来，选择 {name} 应该具备的能力标签（可多选）：' },
    { id: 'description', question: '请用一两句话描述 {name} 的职责和特长：' },
    { id: 'prompt', question: '最后，输入核心提示词——描述专家的回答风格和专业背景：' },
    { id: 'preview', question: '以下是 {name} 的配置预览，确认后点击"创建"：' },
];

const DOMAIN_OPTIONS = [
    { label: '高分子', value: 'polymer', icon: <HeatMapOutlined /> },
    { label: '微生物', value: 'microbe', icon: <BugOutlined /> },
    { label: '递送系统', value: 'delivery', icon: <RocketOutlined /> },
    { label: '活体材料', value: 'living-material', icon: <FileSearchOutlined /> },
    { label: '文献分析', value: 'literature', icon: <FileSearchOutlined /> },
    { label: '实验设计', value: 'experiment', icon: <ExperimentOutlined /> },
    { label: '自定义', value: 'custom', icon: <RobotOutlined /> },
];

const KB_OPTIONS = [
    { label: '高分子库', value: 'kb_polymer', icon: <HeatMapOutlined /> },
    { label: '微生物库', value: 'kb_microbe', icon: <BugOutlined /> },
    { label: '递送应用库', value: 'kb_delivery', icon: <RocketOutlined /> },
];

const CAPABILITY_OPTIONS = [
    '材料筛选', '性能分析', '配方优化', '菌株分析', '代谢分析',
    '载体设计', '文献检索', '数据分析', '知识问答', '方案设计',
    '总结', '报告撰写', '跨库检索', '实验设计',
];

const interpolate = (s: string, vars: Record<string, string>) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, v), s);

export const ExpertCreation: React.FC<ExpertCreationProps> = ({ onComplete, onCancel }) => {
    const [state, setState] = useState<CreationState>({
        step: 0, name: '', avatar: 'general-pro', domain: '',
        capabilities: [], description: '', systemPrompt: '', knowledgeBases: [],
    });
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [creating, setCreating] = useState(false);
    const endRef = useRef<HTMLDivElement>(null);
    const hasInit = useRef(false);

    const addBot = useCallback((content: string) => {
        setIsTyping(true);
        setTimeout(() => {
            setMessages(prev => [...prev, { id: `b-${Date.now()}`, role: 'assistant', content }]);
            setIsTyping(false);
        }, 400);
    }, []);

    useEffect(() => {
        if (!hasInit.current) {
            hasInit.current = true;
            addBot(STEPS[0].question);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

    const addUser = (content: string) => {
        setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content }]);
    };

    const vars = { name: state.name || '专家', domain: state.domain || '领域' };

    const advance = (nextStep: number) => {
        if (nextStep < STEPS.length) {
            setTimeout(() => addBot(interpolate(STEPS[nextStep].question, vars)), 300);
        }
    };

    const handleSend = () => {
        const v = inputValue.trim();
        if (!v && state.step !== 2 && state.step !== 3) return;
        const display = v || (state.step === 3 ? state.capabilities.join('、') : state.step === 2 ? state.knowledgeBases.join('、') : '');
        addUser(display);
        setInputValue('');
        processStep(v);
    };

    const processStep = (value: string) => {
        const s = state.step;
        switch (s) {
            case 0:
                setState(p => ({ ...p, name: value, step: 1 }));
                advance(1);
                break;
            case 1:
                setState(p => ({ ...p, domain: value, step: 2 }));
                advance(2);
                break;
            case 2:
                setState(p => ({ ...p, step: 3 }));
                advance(3);
                break;
            case 3:
                setState(p => ({ ...p, step: 4 }));
                advance(4);
                break;
            case 4:
                setState(p => ({ ...p, description: value, step: 5 }));
                advance(5);
                break;
            case 5:
                setState(p => ({ ...p, systemPrompt: value, step: 6 }));
                advance(6);
                break;
        }
    };

    const toggleKb = (kb: string) => {
        setState(p => ({
            ...p,
            knowledgeBases: p.knowledgeBases.includes(kb)
                ? p.knowledgeBases.filter(k => k !== kb)
                : [...p.knowledgeBases, kb],
        }));
    };

    const toggleCap = (cap: string) => {
        setState(p => ({
            ...p,
            capabilities: p.capabilities.includes(cap)
                ? p.capabilities.filter(c => c !== cap)
                : [...p.capabilities, cap],
        }));
    };

    const handleCreate = async () => {
        setCreating(true);
        try {
            const data: ExpertCreate = {
                name: state.name,
                avatar: state.avatar,
                domain: state.domain,
                description: state.description,
                capabilities: state.capabilities,
                system_prompt: state.systemPrompt,
                knowledge_bases: state.knowledgeBases,
                tools: ['knowledge-search'],
            };
            const created = await expertApi.create(data);
            onComplete(created.id);
        } catch {
            addBot('创建失败，请重试。');
        } finally {
            setCreating(false);
        }
    };

    const isLastBot = (idx: number) => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') return i === idx;
        }
        return false;
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Space>
                    <RobotOutlined />
                    <Text strong>创建专家助手</Text>
                </Space>
                <Steps
                    size="small"
                    current={state.step}
                    className={styles.steps}
                    items={STEPS.map((_, i) => ({ title: '', status: i < state.step ? 'finish' : i === state.step ? 'process' : 'wait' }))}
                />
                <Button size="small" onClick={onCancel}>取消</Button>
            </div>

            <div className={styles.messages}>
                {messages.map((msg, idx) => (
                    <div key={msg.id} className={`${styles.msg} ${styles[msg.role]}`}>
                        <Avatar size={28} className={styles.msgAvatar}>
                            {msg.role === 'assistant' ? <RobotOutlined /> : <UserOutlined />}
                        </Avatar>
                        <div className={styles.msgBody}>
                            <Text>{msg.content}</Text>

                            {/* 领域快捷选项 */}
                            {state.step === 1 && msg.role === 'assistant' && isLastBot(idx) && (
                                <div className={styles.options}>
                                    {DOMAIN_OPTIONS.map(d => (
                                        <Tag
                                            key={d.value}
                                            className={`${styles.optionTag} ${inputValue === d.value ? styles.selected : ''}`}
                                            onClick={() => setInputValue(d.value)}
                                        >
                                            <Space size={4}>
                                                {d.icon}
                                                <span>{d.label}</span>
                                            </Space>
                                        </Tag>
                                    ))}
                                </div>
                            )}

                            {/* 知识库选择 */}
                            {state.step === 2 && msg.role === 'assistant' && isLastBot(idx) && (
                                <div className={styles.options}>
                                    {KB_OPTIONS.map(kb => (
                                        <Tag
                                            key={kb.value}
                                            className={`${styles.optionTag} ${state.knowledgeBases.includes(kb.value) ? styles.selected : ''}`}
                                            onClick={() => toggleKb(kb.value)}
                                        >
                                            <Space size={4}>
                                                {kb.icon}
                                                <span>{kb.label}</span>
                                            </Space>
                                        </Tag>
                                    ))}
                                </div>
                            )}

                            {/* 能力标签 */}
                            {state.step === 3 && msg.role === 'assistant' && isLastBot(idx) && (
                                <div className={styles.options}>
                                    {CAPABILITY_OPTIONS.map(cap => (
                                        <Tag
                                            key={cap}
                                            className={`${styles.optionTag} ${state.capabilities.includes(cap) ? styles.selected : ''}`}
                                            onClick={() => toggleCap(cap)}
                                        >
                                            {state.capabilities.includes(cap) && <CheckOutlined style={{ fontSize: 10, marginRight: 2 }} />}
                                            {cap}
                                        </Tag>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {isTyping && (
                    <div className={`${styles.msg} ${styles.assistant}`}>
                        <Avatar size={28} className={styles.msgAvatar} icon={<RobotOutlined />} />
                        <div className={styles.msgBody}><Text type="secondary">正在输入...</Text></div>
                    </div>
                )}

                {/* 预览 */}
                {state.step === 6 && (
                    <div className={`${styles.msg} ${styles.assistant}`}>
                        <Avatar size={28} className={styles.msgAvatar} icon={<RobotOutlined />} />
                        <div className={styles.msgBody}>
                            <Card size="small" className={styles.previewCard}>
                                <div className={styles.previewAvatars}>
                                    {EXPERT_AVATAR_PRESETS.map((preset) => (
                                        <button
                                            type="button"
                                            key={preset.key}
                                            className={`${styles.avatarOption} ${state.avatar === preset.key ? styles.avatarSelected : ''}`}
                                            onClick={() => setState(p => ({ ...p, avatar: preset.key }))}
                                        >
                                            <ExpertAvatar expert={{ avatar: preset.key, domain: state.domain }} size={22} />
                                            <span className={styles.avatarOptionText}>{preset.label}</span>
                                        </button>
                                    ))}
                                </div>
                                <div className={styles.previewHeader}>
                                    <ExpertAvatar expert={{ avatar: state.avatar, domain: state.domain }} size={42} />
                                    <div>
                                        <Title level={5} style={{ margin: 0 }}>{state.name}</Title>
                                        <Text type="secondary">{state.domain}</Text>
                                    </div>
                                </div>
                                <Text>{state.description}</Text>
                                <div style={{ marginTop: 8 }}>
                                    {state.knowledgeBases.map(kb => (
                                        <Tag key={kb} color="blue">{kb}</Tag>
                                    ))}
                                    {state.capabilities.map(c => (
                                        <Tag key={c}>{c}</Tag>
                                    ))}
                                </div>
                                <div className={styles.previewPrompt}>
                                    {state.systemPrompt.slice(0, 150)}...
                                </div>
                            </Card>
                            <Space style={{ marginTop: 12 }}>
                                <Button onClick={onCancel}>取消</Button>
                                <Button type="primary" onClick={handleCreate} loading={creating}>
                                    创建专家
                                </Button>
                            </Space>
                        </div>
                    </div>
                )}

                <div ref={endRef} />
            </div>

            {/* 输入区 */}
            {state.step < 6 && (
                <div className={styles.inputBar}>
                    <Input.TextArea
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
                        placeholder={state.step === 2 ? '选择知识库后点击发送' : state.step === 3 ? '选择能力后点击发送' : '输入...'}
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        className={styles.textarea}
                    />
                    <Button
                        type="primary"
                        icon={<SendOutlined />}
                        onClick={handleSend}
                        shape="circle"
                        disabled={!inputValue.trim() && state.step !== 2 && state.step !== 3}
                    />
                </div>
            )}
        </div>
    );
};
