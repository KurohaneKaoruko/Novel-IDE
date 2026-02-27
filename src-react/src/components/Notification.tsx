'use client'

import { useState, useCallback } from 'react'
import './Notification.css'

export type NotificationType = 'info' | 'success' | 'warning' | 'error'

export type Notification = {
  id: string
  type: NotificationType
  title?: string
  message: string
  duration?: number
}

let notificationId = 0

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])

  const addNotification = useCallback((notification: Omit<Notification, 'id'>) => {
    const id = `notification-${++notificationId}`
    const newNotification = { ...notification, id }
    
    setNotifications((prev) => [...prev, newNotification])

    // Auto-remove after duration
    const duration = notification.duration ?? 5000
    if (duration > 0) {
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== id))
      }, duration)
    }
  }, [])

  const removeNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }, [])

  return { notifications, addNotification, removeNotification }
}

export function NotificationContainer({ 
  notifications, 
  onRemove 
}: { 
  notifications: Notification[]
  onRemove: (id: string) => void
}) {
  if (notifications.length === 0) return null

  return (
    <div className="notification-container">
      {notifications.map((notification) => (
        <NotificationItem
          key={notification.id}
          notification={notification}
          onRemove={() => onRemove(notification.id)}
        />
      ))}
    </div>
  )
}

function NotificationItem({ 
  notification, 
  onRemove 
}: { 
  notification: Notification
  onRemove: () => void
}) {
  const icons: Record<NotificationType, string> = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    error: '❌',
  }

  return (
    <div className={`notification-item notification-${notification.type}`}>
      <span className="notification-icon">{icons[notification.type]}</span>
      <div className="notification-content">
        {notification.title && (
          <div className="notification-title">{notification.title}</div>
        )}
        <div className="notification-message">{notification.message}</div>
      </div>
      <button className="notification-close" onClick={onRemove}>×</button>
    </div>
  )
}
