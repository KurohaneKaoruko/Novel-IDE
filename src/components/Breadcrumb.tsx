'use client'

import './Breadcrumb.css'

type BreadcrumbItem = {
  label: string
  path?: string
  onClick?: () => void
}

type BreadcrumbProps = {
  items: BreadcrumbItem[]
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  if (items.length === 0) return null

  return (
    <div className="breadcrumb">
      {items.map((item, index) => (
        <span key={index} className="breadcrumb-item">
          {index > 0 && <span className="breadcrumb-separator">/</span>}
          {item.onClick ? (
            <button className="breadcrumb-link" onClick={item.onClick}>
              {item.label}
            </button>
          ) : (
            <span className="breadcrumb-current">{item.label}</span>
          )}
        </span>
      ))}
    </div>
  )
}
