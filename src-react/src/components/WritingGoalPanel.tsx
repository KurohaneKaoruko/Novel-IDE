import React, { useState, useEffect } from 'react';
import { writingGoalService } from '../services';
import type { WritingGoal, DailyStats, WritingHistory } from '../services';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Bar, BarChart } from 'recharts';
import './WritingGoalPanel.css';

export interface WritingGoalPanelProps {
  onGoalUpdate?: () => void;
}

/**
 * WritingGoalPanel Component
 * Displays and manages writing goals and progress tracking
 * Shows daily word count goal, progress, and historical statistics
 */
export const WritingGoalPanel: React.FC<WritingGoalPanelProps> = ({
  onGoalUpdate,
}) => {
  const [goal, setGoal] = useState<WritingGoal | null>(null);
  const [todayStats, setTodayStats] = useState<DailyStats | null>(null);
  const [history, setHistory] = useState<WritingHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [newGoalValue, setNewGoalValue] = useState('');
  const [showCongratulations, setShowCongratulations] = useState(false);
  const previousProgressRef = React.useRef<number>(0);

  // Load data on mount
  useEffect(() => {
    loadData();
  }, []);

  // Check for goal completion and show congratulations
  useEffect(() => {
    if (todayStats) {
      // Check if goal was just completed (progress went from < 1 to >= 1)
      if (todayStats.progress >= 1 && previousProgressRef.current < 1) {
        setShowCongratulations(true);
        
        // Auto-hide congratulations after 5 seconds
        const timer = setTimeout(() => {
          setShowCongratulations(false);
        }, 5000);
        
        return () => clearTimeout(timer);
      }
      
      previousProgressRef.current = todayStats.progress;
    }
  }, [todayStats]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [goalData, statsData, historyData] = await Promise.all([
        writingGoalService.getCurrentGoal(),
        writingGoalService.getTodayStats(),
        writingGoalService.getHistory(30), // Last 30 days
      ]);
      
      setGoal(goalData);
      setTodayStats(statsData);
      setHistory(historyData);
      setNewGoalValue(goalData.dailyWordCount.toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load writing goal data');
    } finally {
      setLoading(false);
    }
  };

  const handleGoalEdit = () => {
    setIsEditingGoal(true);
  };

  const handleGoalSave = async () => {
    try {
      const goalValue = parseInt(newGoalValue, 10);
      
      if (isNaN(goalValue) || goalValue < 0) {
        setError('请输入有效的字数目标');
        return;
      }

      await writingGoalService.setDailyGoal(goalValue);
      setIsEditingGoal(false);
      
      // Reload data
      await loadData();
      
      if (onGoalUpdate) {
        onGoalUpdate();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update goal');
    }
  };

  const handleGoalCancel = () => {
    setIsEditingGoal(false);
    if (goal) {
      setNewGoalValue(goal.dailyWordCount.toString());
    }
  };

  // Format time spent (seconds to hours:minutes)
  const formatTimeSpent = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}小时${minutes}分钟`;
    }
    return `${minutes}分钟`;
  };

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  // Prepare chart data
  const chartData = React.useMemo(() => {
    return history
      .slice()
      .reverse() // Show oldest to newest
      .map(entry => ({
        date: formatDate(entry.date),
        实际字数: entry.wordCount,
        目标字数: entry.goal,
        完成: entry.achieved ? 1 : 0,
      }));
  }, [history]);

  if (loading) {
    return (
      <div className="writing-goal-panel">
        <div className="writing-goal-loading">加载中...</div>
      </div>
    );
  }

  if (error && !goal) {
    return (
      <div className="writing-goal-panel">
        <div className="writing-goal-error">
          <p>错误: {error}</p>
          <button onClick={loadData}>重试</button>
        </div>
      </div>
    );
  }

  return (
    <div className="writing-goal-panel">
      {/* Congratulations overlay */}
      {showCongratulations && (
        <div className="congratulations-overlay">
          <div className="congratulations-content">
            <div className="congratulations-icon">🎉</div>
            <h2>恭喜！</h2>
            <p>今日写作目标已完成！</p>
            <button onClick={() => setShowCongratulations(false)} className="btn-close-congrats">
              关闭
            </button>
          </div>
        </div>
      )}
      
      {/* Error banner for non-fatal errors */}
      {error && goal && (
        <div className="writing-goal-error-banner">
          <span>错误: {error}</span>
          <button onClick={() => setError(null)}>关闭</button>
        </div>
      )}
      
      {/* Header */}
      <div className="writing-goal-header">
        <h2>写作目标</h2>
      </div>

      {/* Today's Progress */}
      {todayStats && (
        <div className="today-progress-section">
          <h3>今日进度</h3>
          
          <div className="progress-stats">
            <div className="stat-row">
              <span className="stat-label">目标字数:</span>
              <span className="stat-value">
                {isEditingGoal ? (
                  <div className="goal-edit-inline">
                    <input
                      type="number"
                      value={newGoalValue}
                      onChange={(e) => setNewGoalValue(e.target.value)}
                      className="goal-input"
                      min="0"
                    />
                    <button onClick={handleGoalSave} className="btn-save">保存</button>
                    <button onClick={handleGoalCancel} className="btn-cancel">取消</button>
                  </div>
                ) : (
                  <>
                    {todayStats.goal.toLocaleString()} 字
                    <button onClick={handleGoalEdit} className="btn-edit">编辑</button>
                  </>
                )}
              </span>
            </div>
            
            <div className="stat-row">
              <span className="stat-label">实际字数:</span>
              <span className="stat-value">{todayStats.wordCount.toLocaleString()} 字</span>
            </div>
            
            <div className="stat-row">
              <span className="stat-label">写作时长:</span>
              <span className="stat-value">{formatTimeSpent(todayStats.timeSpent)}</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="progress-bar-container">
            <div className="progress-bar-label">
              <span>完成度</span>
              <span className="progress-percentage">
                {Math.round(todayStats.progress * 100)}%
              </span>
            </div>
            <div className="progress-bar">
              <div
                className={`progress-bar-fill ${
                  todayStats.progress >= 1 ? 'progress-complete' : ''
                }`}
                style={{ width: `${Math.min(100, todayStats.progress * 100)}%` }}
              />
            </div>
          </div>

          {/* Congratulations message */}
          {todayStats.progress >= 1 && (
            <div className="congratulations-message">
              🎉 恭喜！今日目标已完成！
            </div>
          )}
        </div>
      )}

      {/* Streak Information */}
      {goal && (
        <div className="streak-section">
          <h3>连续记录</h3>
          <div className="streak-stats">
            <div className="streak-item">
              <span className="streak-label">当前连续:</span>
              <span className="streak-value">{goal.currentStreak} 天</span>
            </div>
            <div className="streak-item">
              <span className="streak-label">最长连续:</span>
              <span className="streak-value">{goal.longestStreak} 天</span>
            </div>
          </div>
        </div>
      )}

      {/* History Chart */}
      {chartData.length > 0 && (
        <div className="history-section">
          <h3>历史记录 (最近30天)</h3>
          
          {/* Word Count Chart */}
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="实际字数"
                  stroke="#6e6e6e"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="目标字数"
                  stroke="#888888"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Achievement Chart */}
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis domain={[0, 1]} ticks={[0, 1]} />
                <Tooltip
                  formatter={(value: number | undefined) => (value === 1 ? '已完成' : '未完成')}
                />
                <Bar dataKey="完成" fill="#6e6e6e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* History List */}
      {history.length > 0 && (
        <div className="history-list-section">
          <h3>详细记录</h3>
          <div className="history-list">
            {history.slice(0, 10).map((entry, index) => (
              <div key={index} className="history-item">
                <div className="history-date">{entry.date}</div>
                <div className="history-stats">
                  <span className="history-wordcount">
                    {entry.wordCount.toLocaleString()} / {entry.goal.toLocaleString()} 字
                  </span>
                  <span className={`history-badge ${entry.achieved ? 'badge-success' : 'badge-pending'}`}>
                    {entry.achieved ? '✓ 已完成' : '○ 未完成'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {history.length === 0 && (
        <div className="history-empty">
          <p>暂无历史记录</p>
          <p className="hint">开始写作以记录进度</p>
        </div>
      )}
    </div>
  );
};
