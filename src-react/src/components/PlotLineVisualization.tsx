import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import type { PlotLine } from '../services/PlotLineService';
import './PlotLineVisualization.css';

interface PlotLineVisualizationProps {
  plotLines: PlotLine[];
  chapters: Array<{ id: string; title: string; order: number }>;
  onPlotLineClick?: (plotLine: PlotLine) => void;
}

/**
 * Visualizes plot lines as a timeline/Gantt chart
 */
export const PlotLineVisualization: React.FC<PlotLineVisualizationProps> = ({
  plotLines,
  chapters,
  onPlotLineClick,
}) => {
  // Create a mapping of chapter IDs to their order
  const chapterOrderMap = new Map<string, number>();
  chapters.forEach(chapter => {
    chapterOrderMap.set(chapter.id, chapter.order);
  });

  // Transform plot lines into chart data
  const chartData = plotLines.map(plotLine => {
    const startOrder = chapterOrderMap.get(plotLine.startChapter) ?? 0;
    const endOrder = plotLine.endChapter 
      ? (chapterOrderMap.get(plotLine.endChapter) ?? startOrder)
      : startOrder;

    // Ensure start is always <= end for visualization
    const actualStart = Math.min(startOrder, endOrder);
    const actualEnd = Math.max(startOrder, endOrder);

    return {
      name: plotLine.name,
      start: actualStart,
      end: actualEnd,
      span: actualEnd - actualStart + 1,
      status: plotLine.status,
      plotLine,
    };
  });

  // Sort by start order
  chartData.sort((a, b) => a.start - b.start);

  // Get color based on status
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return '#4caf50'; // Green
      case 'paused':
        return '#ff9800'; // Orange
      case 'ongoing':
      default:
        return '#2196f3'; // Blue
    }
  };

  // Handle bar click
  const handleBarClick = (data: any) => {
    if (onPlotLineClick && data.plotLine) {
      onPlotLineClick(data.plotLine);
    }
  };

  if (plotLines.length === 0) {
    return (
      <div className="plot-line-visualization-empty">
        <p>暂无情节线数据</p>
      </div>
    );
  }

  return (
    <div className="plot-line-visualization">
      <ResponsiveContainer width="100%" height={Math.max(300, plotLines.length * 50)}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 20, right: 30, left: 100, bottom: 20 }}
        >
          <XAxis 
            type="number" 
            domain={[0, chapters.length]}
            label={{ value: '章节顺序', position: 'insideBottom', offset: -10 }}
          />
          <YAxis 
            type="category" 
            dataKey="name" 
            width={90}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="plot-line-tooltip">
                    <p className="tooltip-title">{data.name}</p>
                    <p>起始章节: {data.start + 1}</p>
                    <p>结束章节: {data.end + 1}</p>
                    <p>跨度: {data.span} 章</p>
                    <p>状态: {
                      data.status === 'ongoing' ? '进行中' :
                      data.status === 'completed' ? '已完结' :
                      '暂停'
                    }</p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Legend />
          <Bar 
            dataKey="span" 
            name="章节跨度"
            onClick={handleBarClick}
            style={{ cursor: onPlotLineClick ? 'pointer' : 'default' }}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={getStatusColor(entry.status)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};
