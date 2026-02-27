/**
 * Performance monitoring utilities for the editor
 * Helps track load times, memory usage, and other performance metrics
 */

export interface PerformanceMetrics {
  loadTime?: number
  memoryUsage?: number
  documentSize?: number
  timestamp: number
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = []
  private maxMetrics = 100 // Keep last 100 measurements

  /**
   * Measure editor load time
   */
  measureLoadTime(startTime: number, documentSize: number): number {
    const loadTime = performance.now() - startTime
    
    this.addMetric({
      loadTime,
      documentSize,
      memoryUsage: this.getMemoryUsage(),
      timestamp: Date.now(),
    })
    
    return loadTime
  }

  /**
   * Get current memory usage (if available)
   */
  getMemoryUsage(): number | undefined {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memory = (performance as any).memory
      return memory.usedJSHeapSize / (1024 * 1024) // Convert to MB
    }
    return undefined
  }

  /**
   * Add a performance metric
   */
  private addMetric(metric: PerformanceMetrics): void {
    this.metrics.push(metric)
    
    // Keep only the last maxMetrics measurements
    if (this.metrics.length > this.maxMetrics) {
      this.metrics.shift()
    }
  }

  /**
   * Get average load time
   */
  getAverageLoadTime(): number | null {
    const loadTimes = this.metrics
      .filter(m => m.loadTime !== undefined)
      .map(m => m.loadTime!)
    
    if (loadTimes.length === 0) return null
    
    return loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length
  }

  /**
   * Get average memory usage
   */
  getAverageMemoryUsage(): number | null {
    const memoryUsages = this.metrics
      .filter(m => m.memoryUsage !== undefined)
      .map(m => m.memoryUsage!)
    
    if (memoryUsages.length === 0) return null
    
    return memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length
  }

  /**
   * Get performance summary
   */
  getSummary(): {
    avgLoadTime: number | null
    avgMemoryUsage: number | null
    totalMeasurements: number
    lastMeasurement: PerformanceMetrics | null
  } {
    return {
      avgLoadTime: this.getAverageLoadTime(),
      avgMemoryUsage: this.getAverageMemoryUsage(),
      totalMeasurements: this.metrics.length,
      lastMeasurement: this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null,
    }
  }

  /**
   * Log performance summary to console
   */
  logSummary(): void {
    const summary = this.getSummary()
    
    console.group('📊 Editor Performance Summary')
    console.log(`Total measurements: ${summary.totalMeasurements}`)
    
    if (summary.avgLoadTime !== null) {
      console.log(`Average load time: ${summary.avgLoadTime.toFixed(2)}ms`)
    }
    
    if (summary.avgMemoryUsage !== null) {
      console.log(`Average memory usage: ${summary.avgMemoryUsage.toFixed(2)}MB`)
    }
    
    if (summary.lastMeasurement) {
      console.log('Last measurement:', {
        loadTime: summary.lastMeasurement.loadTime?.toFixed(2) + 'ms',
        memoryUsage: summary.lastMeasurement.memoryUsage?.toFixed(2) + 'MB',
        documentSize: summary.lastMeasurement.documentSize,
        timestamp: new Date(summary.lastMeasurement.timestamp).toLocaleString(),
      })
    }
    
    console.groupEnd()
  }

  /**
   * Check if performance is within acceptable thresholds
   */
  checkThresholds(thresholds: {
    maxLoadTime?: number
    maxMemoryUsage?: number
  }): {
    loadTimeOk: boolean
    memoryUsageOk: boolean
    warnings: string[]
  } {
    const summary = this.getSummary()
    const warnings: string[] = []
    
    let loadTimeOk = true
    let memoryUsageOk = true
    
    if (thresholds.maxLoadTime && summary.avgLoadTime !== null) {
      loadTimeOk = summary.avgLoadTime <= thresholds.maxLoadTime
      if (!loadTimeOk) {
        warnings.push(
          `Average load time (${summary.avgLoadTime.toFixed(2)}ms) exceeds threshold (${thresholds.maxLoadTime}ms)`
        )
      }
    }
    
    if (thresholds.maxMemoryUsage && summary.avgMemoryUsage !== null) {
      memoryUsageOk = summary.avgMemoryUsage <= thresholds.maxMemoryUsage
      if (!memoryUsageOk) {
        warnings.push(
          `Average memory usage (${summary.avgMemoryUsage.toFixed(2)}MB) exceeds threshold (${thresholds.maxMemoryUsage}MB)`
        )
      }
    }
    
    return { loadTimeOk, memoryUsageOk, warnings }
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = []
  }
}

// Export singleton instance
export const performanceMonitor = new PerformanceMonitor()

// Export for testing
export { PerformanceMonitor }
