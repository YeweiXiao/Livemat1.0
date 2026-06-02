import React, { useMemo } from 'react';
import {
    ResponsiveContainer,
    ComposedChart,
    Line,
    Area,
    Scatter,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    Legend,
} from 'recharts';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import styles from './PhaseDiagramCard.module.css';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CurveData {
    label: string;
    curve_type: string;
    points: Array<{ x: number; y: number }>;
    style?: string;
    color?: string;
}

interface RegionData {
    label: string;
    boundary_points?: Array<{ x: number; y: number }>;
    color?: string;
    opacity?: number;
}

interface CriticalPointData {
    label: string;
    x: number;
    y: number;
    annotation?: string;
}

interface FormulaData {
    latex: string;
    description?: string;
}

interface AnnotationData {
    text: string;
    x: number;
    y: number;
}

export interface PhaseDiagramPayload {
    type: 'phase_diagram';
    title?: string;
    diagram_type?: string;
    axes?: {
        x?: { label?: string; unit?: string; min?: number; max?: number };
        y?: { label?: string; unit?: string; min?: number; max?: number };
    };
    curves?: CurveData[];
    regions?: RegionData[];
    critical_points?: CriticalPointData[];
    formulas?: FormulaData[];
    annotations?: AnnotationData[];
    system_info?: string;
    conditions?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const DEFAULT_COLORS = [
    '#2563eb', '#dc2626', '#16a34a', '#f59e0b',
    '#7c3aed', '#0891b2', '#db2777', '#65a30d',
];

const STROKE_DASH: Record<string, string> = {
    dashed: '8 4',
    dotted: '3 3',
};

function renderLatexBlock(latex: string): string {
    try {
        return katex.renderToString(latex, {
            throwOnError: false,
            displayMode: true,
            output: 'html',
        });
    } catch {
        return latex;
    }
}

/* ------------------------------------------------------------------ */
/*  Custom Scatter Dot                                                 */
/* ------------------------------------------------------------------ */

const CriticalDot: React.FC<{
    cx?: number;
    cy?: number;
    payload?: CriticalPointData;
}> = ({ cx, cy, payload }) => {
    if (cx == null || cy == null) return null;
    return (
        <g>
            <circle cx={cx} cy={cy} r={6} fill="#fff" stroke="#dc2626" strokeWidth={2.5} />
            <circle cx={cx} cy={cy} r={2.5} fill="#dc2626" />
            {payload?.label && (
                <text
                    x={cx + 10}
                    y={cy - 10}
                    fill="#374151"
                    fontSize={11}
                    fontWeight={600}
                >
                    {payload.label}
                </text>
            )}
        </g>
    );
};

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export const PhaseDiagramCard: React.FC<{ payload: PhaseDiagramPayload }> = ({ payload }) => {
    const {
        title,
        diagram_type,
        axes,
        curves = [],
        regions = [],
        critical_points: criticalPoints = [],
        formulas = [],
        annotations = [],
        system_info: systemInfo,
        conditions,
    } = payload;

    const xAxis = axes?.x || {};
    const yAxis = axes?.y || {};

    const xLabel = xAxis.label
        ? `${xAxis.label}${xAxis.unit ? ` (${xAxis.unit})` : ''}`
        : '';
    const yLabel = yAxis.label
        ? `${yAxis.label}${yAxis.unit ? ` (${yAxis.unit})` : ''}`
        : '';

    // Merge all curve data into a unified dataset keyed by x
    const { chartData, curveKeys } = useMemo(() => {
        const xSet = new Set<number>();
        curves.forEach(c => c.points?.forEach(p => xSet.add(p.x)));
        const sortedX = Array.from(xSet).sort((a, b) => a - b);

        const keys = curves.map((_, i) => `curve_${i}`);
        const rows = sortedX.map(x => {
            const row: Record<string, number | null> = { x };
            curves.forEach((c, i) => {
                const pt = c.points?.find(p => p.x === x);
                row[keys[i]] = pt ? pt.y : null;
            });
            return row;
        });
        return { chartData: rows, curveKeys: keys };
    }, [curves]);

    // Compute domain bounds
    const xDomain: [number, number] = useMemo(() => {
        if (xAxis.min != null && xAxis.max != null) return [xAxis.min, xAxis.max];
        let min = Infinity, max = -Infinity;
        curves.forEach(c => c.points?.forEach(p => {
            if (p.x < min) min = p.x;
            if (p.x > max) max = p.x;
        }));
        return [isFinite(min) ? min : 0, isFinite(max) ? max : 100];
    }, [curves, xAxis]);

    const yDomain: [number, number] = useMemo(() => {
        if (yAxis.min != null && yAxis.max != null) return [yAxis.min, yAxis.max];
        let min = Infinity, max = -Infinity;
        curves.forEach(c => c.points?.forEach(p => {
            if (p.y < min) min = p.y;
            if (p.y > max) max = p.y;
        }));
        const pad = (max - min) * 0.05 || 5;
        return [isFinite(min) ? min - pad : 0, isFinite(max) ? max + pad : 100];
    }, [curves, yAxis]);

    // Diagram type badge label
    const typeLabel = useMemo(() => {
        const map: Record<string, string> = {
            binary_phase: 'Binary Phase',
            ucst_lcst: 'UCST / LCST',
            sol_gel: 'Sol-Gel Transition',
            atps: 'ATPS',
            polymer_blend: 'Polymer Blend',
            custom: 'Phase Diagram',
        };
        return map[diagram_type || ''] || 'Phase Diagram';
    }, [diagram_type]);

    if (curves.length === 0) return null;

    return (
        <div className={styles.card}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <span className={styles.badge}>{typeLabel}</span>
                    <h3 className={styles.title}>{title || 'Phase Diagram'}</h3>
                </div>
                {conditions && (
                    <span className={styles.conditions}>{conditions}</span>
                )}
            </div>

            {/* Chart */}
            <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height={380}>
                    <ComposedChart
                        data={chartData}
                        margin={{ top: 20, right: 30, bottom: 40, left: 20 }}
                    >
                        <defs>
                            {curves.map((c, i) => (
                                <linearGradient
                                    key={`grad_${i}`}
                                    id={`areaGrad_${i}`}
                                    x1="0" y1="0" x2="0" y2="1"
                                >
                                    <stop
                                        offset="0%"
                                        stopColor={c.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                                        stopOpacity={0.15}
                                    />
                                    <stop
                                        offset="100%"
                                        stopColor={c.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                                        stopOpacity={0.02}
                                    />
                                </linearGradient>
                            ))}
                        </defs>

                        <CartesianGrid
                            strokeDasharray="3 6"
                            stroke="var(--border-primary, #e5e7eb)"
                            strokeOpacity={0.5}
                        />

                        <XAxis
                            dataKey="x"
                            type="number"
                            domain={xDomain}
                            tick={{ fontSize: 11, fill: 'var(--text-secondary, #6b7280)' }}
                            label={{
                                value: xLabel,
                                position: 'insideBottom',
                                offset: -20,
                                style: {
                                    fontSize: 12,
                                    fontWeight: 500,
                                    fill: 'var(--text-primary, #374151)',
                                },
                            }}
                        />
                        <YAxis
                            type="number"
                            domain={yDomain}
                            tick={{ fontSize: 11, fill: 'var(--text-secondary, #6b7280)' }}
                            label={{
                                value: yLabel,
                                angle: -90,
                                position: 'insideLeft',
                                offset: 5,
                                style: {
                                    fontSize: 12,
                                    fontWeight: 500,
                                    fill: 'var(--text-primary, #374151)',
                                    textAnchor: 'middle',
                                },
                            }}
                        />

                        <RechartsTooltip
                            contentStyle={{
                                background: 'var(--bg-primary, #fff)',
                                border: '1px solid var(--border-primary, #e5e7eb)',
                                borderRadius: 8,
                                fontSize: 12,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                            }}
                            formatter={(value: any, name: any) => {
                                const nameStr = String(name ?? '');
                                const idx = curveKeys.indexOf(nameStr);
                                const label = idx >= 0 ? curves[idx]?.label : nameStr;
                                return [typeof value === 'number' ? value.toFixed(2) : String(value ?? ''), label];
                            }}
                        />

                        <Legend
                            verticalAlign="top"
                            align="right"
                            wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                            formatter={(value: string) => {
                                const idx = curveKeys.indexOf(value);
                                return idx >= 0 ? curves[idx]?.label || value : value;
                            }}
                        />

                        {/* Region fills (first curve as area) */}
                        {curves.length > 0 && curves[0].points?.length > 0 && (
                            <Area
                                dataKey={curveKeys[0]}
                                type="monotone"
                                fill={`url(#areaGrad_0)`}
                                stroke="none"
                                connectNulls
                                isAnimationActive={false}
                                legendType="none"
                            />
                        )}

                        {/* Curves */}
                        {curves.map((c, i) => (
                            <Line
                                key={curveKeys[i]}
                                dataKey={curveKeys[i]}
                                type="monotone"
                                stroke={c.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                                strokeWidth={2.5}
                                strokeDasharray={STROKE_DASH[c.style || ''] || undefined}
                                dot={false}
                                connectNulls
                                isAnimationActive
                                animationDuration={800}
                                animationEasing="ease-out"
                            />
                        ))}

                        {/* Critical points */}
                        {criticalPoints.length > 0 && (
                            <Scatter
                                data={criticalPoints}
                                shape={<CriticalDot />}
                                isAnimationActive={false}
                                legendType="none"
                            />
                        )}

                        {/* SVG overlays for regions and annotations */}
                        {(regions.length > 0 || annotations.length > 0) && (
                            <g className="custom-overlays" />
                        )}
                    </ComposedChart>
                </ResponsiveContainer>

                {/* Annotation labels (positioned absolutely over the chart) */}
                {annotations.length > 0 && (
                    <div className={styles.annotationsLayer}>
                        {annotations.map((a, i) => (
                            <div
                                key={i}
                                className={styles.annotation}
                                style={{
                                    left: `${((a.x - xDomain[0]) / (xDomain[1] - xDomain[0])) * 100}%`,
                                    bottom: `${((a.y - yDomain[0]) / (yDomain[1] - yDomain[0])) * 100}%`,
                                }}
                            >
                                {a.text}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Formulas */}
            {formulas.length > 0 && (
                <div className={styles.formulasSection}>
                    <div className={styles.formulasHeader}>Governing Equations</div>
                    <div className={styles.formulasList}>
                        {formulas.map((f, i) => (
                            <div key={i} className={styles.formulaItem}>
                                <div
                                    className={styles.formulaLatex}
                                    dangerouslySetInnerHTML={{
                                        __html: renderLatexBlock(f.latex),
                                    }}
                                />
                                {f.description && (
                                    <div className={styles.formulaDesc}>{f.description}</div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* System info footer */}
            {systemInfo && (
                <div className={styles.systemInfo}>{systemInfo}</div>
            )}
        </div>
    );
};

export default PhaseDiagramCard;
